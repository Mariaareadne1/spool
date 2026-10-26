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
  /** Bumped by stop(); a start() that resumes after an await with a stale generation aborts. */
  private generation = 0;
  private starting = false;
  /** Detection frames per second, smoothed. */
  fps = 0;

  constructor(private onHands: HandsListener, private onStatus: (s: TrackerStatus) => void) {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
  }

  async start(): Promise<void> {
    if (this.running || this.starting) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.onStatus({ kind: 'error', reason: 'unsupported', message: 'This browser cannot access a camera.' });
      return;
    }
    const gen = ++this.generation;
    const stale = () => gen !== this.generation;
    this.starting = true;
    this.onStatus({ kind: 'requesting' });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (err) {
      this.starting = false;
      if (stale()) return;
      const name = err instanceof DOMException ? err.name : '';
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      this.onStatus({
        kind: 'error',
        reason: denied ? 'denied' : 'no-camera',
        message: denied ? 'Camera access was declined.' : 'No camera was found.',
      });
      return;
    }
    if (stale()) {
      stream.getTracks().forEach((t) => t.stop());
      this.starting = false;
      return;
    }
    this.stream = stream;
    // a camera that disappears mid-performance must not leave a note hanging
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', this.lost));
    this.onStatus({ kind: 'loading' });
    let landmarker: HandLandmarker;
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
        landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
      }
      if (stale()) {
        landmarker.close();
        this.starting = false;
        return;
      }
      this.landmarker = landmarker;
      this.video.srcObject = stream;
      await this.video.play();
    } catch (err) {
      this.starting = false;
      if (stale()) return;
      this.stop();
      this.onStatus({ kind: 'error', reason: 'model', message: `Hand tracking failed to start: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    this.starting = false;
    if (stale()) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onStatus({ kind: 'running' });
    this.loop();
  }

  /** Tell the listener there are no hands (releases any held gesture note). */
  private lost = (): void => {
    this.onHands([], performance.now());
  };

  private onVisibility = (): void => {
    if (document.hidden) this.lost();
  };

  private loop = (): void => {
    if (!this.running) return;
    const v = this.video;
    try {
      if (this.landmarker && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = v.currentTime;
        const t = performance.now();
        const result = this.landmarker.detectForVideo(v, t);
        const hands: RawHand[] = result.landmarks.map((landmarks) => ({ landmarks }));
        const dt = performance.now() - t;
        this.fps = this.fps * 0.9 + (1000 / Math.max(16, dt)) * 0.1;
        this.onHands(hands, t);
      }
    } catch {
      // one bad frame (e.g. a transient GPU error) must not end tracking or strand a note
      this.lost();
    }
    if ('requestVideoFrameCallback' in v) {
      this.frameHandle = v.requestVideoFrameCallback(() => this.loop());
    } else {
      this.frameHandle = requestAnimationFrame(this.loop);
    }
  };

  stop(): void {
    this.generation += 1;
    this.starting = false;
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.frameHandle);
    cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach((t) => {
      t.removeEventListener('ended', this.lost);
      t.stop();
    });
    this.stream = null;
    this.video.srcObject = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.onStatus({ kind: 'idle' });
  }
}
