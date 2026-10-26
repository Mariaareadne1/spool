import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type { RawHand } from './interpret';

export type TrackerStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'requesting' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'running' }
  | { readonly kind: 'error'; readonly reason: 'denied' | 'no-camera' | 'model' | 'unsupported'; readonly message: string };

export type HandsListener = (hands: RawHand[], tMs: number) => void;

const BASE = import.meta.env.BASE_URL;

/**
 * Webcam + MediaPipe HandLandmarker. Runs detection once per new video frame
 * (requestVideoFrameCallback where available) and hands raw landmarks to a
 * listener — the same entry point synthetic test fixtures use.
 */
export class HandTracker {
  readonly video: HTMLVideoElement;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private lastVideoTime = -1;
  private frameHandle = 0;
  /** Detection frames per second, smoothed. */
  fps = 0;

  constructor(private onHands: HandsListener, private onStatus: (s: TrackerStatus) => void) {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.onStatus({ kind: 'error', reason: 'unsupported', message: 'This browser cannot access a camera.' });
      return;
    }
    this.onStatus({ kind: 'requesting' });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      this.onStatus({
        kind: 'error',
        reason: denied ? 'denied' : 'no-camera',
        message: denied ? 'Camera access was declined.' : 'No camera was found.',
      });
      return;
    }
    this.onStatus({ kind: 'loading' });
    try {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe`);
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: `${BASE}models/hand_landmarker.task`, delegate },
        runningMode: 'VIDEO' as const,
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
      }
    } catch (err) {
      this.stop();
      this.onStatus({ kind: 'error', reason: 'model', message: `Hand tracking failed to load: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.onStatus({ kind: 'running' });
    this.loop();
  }

  private loop = (): void => {
    if (!this.running) return;
    const v = this.video;
    if (this.landmarker && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const t = performance.now();
      const result = this.landmarker.detectForVideo(v, t);
      const hands: RawHand[] = result.landmarks.map((landmarks) => ({ landmarks }));
      const dt = performance.now() - t;
      this.fps = this.fps * 0.9 + (1000 / Math.max(16, dt)) * 0.1;
      this.onHands(hands, t);
    }
    if ('requestVideoFrameCallback' in v) {
      this.frameHandle = v.requestVideoFrameCallback(() => this.loop());
    } else {
      this.frameHandle = requestAnimationFrame(this.loop);
    }
  };

  stop(): void {
    this.running = false;
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.frameHandle);
    cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.onStatus({ kind: 'idle' });
  }
}
