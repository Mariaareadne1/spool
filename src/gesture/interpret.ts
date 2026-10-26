/**
 * Raw MediaPipe hand landmarks → stable musical gesture state.
 *
 * Everything is normalised by palm size (wrist → middle-finger knuckle), so a
 * pinch reads the same whether the hand is 40 cm or 1.5 m from the camera.
 * Pinch uses hysteresis (close below ON, open above OFF) so a hand hovering
 * at the threshold cannot machine-gun notes. Cursor positions are mirrored
 * into screen space (the preview is a mirror) and One-Euro filtered.
 */

export interface Landmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RawHand {
  readonly landmarks: readonly Landmark[];
}

export type HandRole = 'play' | 'control';

export interface HandState {
  readonly role: HandRole;
  /** Pinch point (between thumb and index tips) in mirrored screen space, 0..1. */
  readonly x: number;
  readonly y: number;
  /** Thumb–index distance divided by palm size. */
  readonly pinchRatio: number;
  readonly pinched: boolean;
  /** Mean fingertip–wrist distance divided by palm size. ~2 open, ~1 fist. */
  readonly openness: number;
  readonly open: boolean;
  /** Palm size in normalised image units — larger is closer to the camera. */
  readonly size: number;
  /** All 21 points, mirrored, for drawing the skeleton. */
  readonly points: readonly Landmark[];
}

export interface GestureFrame {
  readonly t: number;
  readonly hands: readonly HandState[];
  readonly play: HandState | null;
  readonly control: HandState | null;
}

export const PINCH_ON = 0.32;
export const PINCH_OFF = 0.5;
export const OPEN_ON = 1.75;
export const OPEN_OFF = 1.55;

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const TIPS = [8, 12, 16, 20];

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

/** One-Euro filter (Casiez et al., 2012): smooth when still, responsive when moving. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  // Tuned on step response: a full-rail jump settles in ~5 frames at 30 fps, ±1% jitter is held to <0.1%.
  constructor(private minCutoff = 1.0, private beta = 1.5, private dCutoff = 1.0) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

interface Track {
  fx: OneEuro;
  fy: OneEuro;
  pinched: boolean;
  open: boolean;
  /** Raw (unfiltered) positions of the last two frames, for constant-velocity role matching. */
  lastX: number;
  lastY: number;
  vx: number;
  vy: number;
}

function freshTrack(): Track {
  return { fx: new OneEuro(), fy: new OneEuro(), pinched: false, open: false, lastX: 0.5, lastY: 0.5, vx: 0, vy: 0 };
}

export function measureHand(landmarks: readonly Landmark[]): { palm: number; pinchRatio: number; openness: number; px: number; py: number } {
  const palm = Math.max(1e-4, dist(landmarks[WRIST], landmarks[MIDDLE_MCP]));
  const pinchRatio = dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / palm;
  const openness = TIPS.reduce((s, i) => s + dist(landmarks[i], landmarks[WRIST]), 0) / TIPS.length / palm;
  const px = 1 - (landmarks[THUMB_TIP].x + landmarks[INDEX_TIP].x) / 2;
  const py = (landmarks[THUMB_TIP].y + landmarks[INDEX_TIP].y) / 2;
  return { palm, pinchRatio, openness, px, py };
}

export class GestureInterpreter {
  private tracks: Record<HandRole, Track> = { play: freshTrack(), control: freshTrack() };
  private present: Record<HandRole, boolean> = { play: false, control: false };

  /** Left-handed players perform with the hand on the left of the mirror. */
  constructor(public lefty = false) {}

  reset(): void {
    this.tracks = { play: freshTrack(), control: freshTrack() };
    this.present = { play: false, control: false };
  }

  process(raw: readonly RawHand[], tMs: number): GestureFrame {
    const valid = raw.filter((h) => h.landmarks.length >= 21).slice(0, 2);
    const measured = valid.map((h) => ({ hand: h, m: measureHand(h.landmarks) }));
    const roles = this.assignRoles(measured.map((v) => ({ x: v.m.px, y: v.m.py })));

    const hands: HandState[] = [];
    const seen: Record<HandRole, boolean> = { play: false, control: false };
    measured.forEach((v, i) => {
      const role = roles[i];
      seen[role] = true;
      const tr = this.tracks[role];
      if (!this.present[role]) {
        tr.fx.reset();
        tr.fy.reset();
        tr.pinched = false;
        tr.open = false;
      }
      const x = tr.fx.filter(v.m.px, tMs);
      const y = tr.fy.filter(v.m.py, tMs);
      tr.vx = this.present[role] ? v.m.px - tr.lastX : 0;
      tr.vy = this.present[role] ? v.m.py - tr.lastY : 0;
      tr.lastX = v.m.px;
      tr.lastY = v.m.py;
      tr.pinched = tr.pinched ? v.m.pinchRatio < PINCH_OFF : v.m.pinchRatio < PINCH_ON;
      tr.open = tr.open ? v.m.openness > OPEN_OFF : v.m.openness > OPEN_ON && !tr.pinched;
      hands.push({
        role, x, y,
        pinchRatio: v.m.pinchRatio,
        pinched: tr.pinched,
        openness: v.m.openness,
        open: tr.open,
        size: v.m.palm,
        points: v.hand.landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })),
      });
    });
    this.present = seen;
    return {
      t: tMs,
      hands,
      play: hands.find((h) => h.role === 'play') ?? null,
      control: hands.find((h) => h.role === 'control') ?? null,
    };
  }

  /**
   * One hand is always the play hand. With two, the hand on the dominant side
   * plays — but if both were already tracked, keep identities by nearest
   * predicted position (constant velocity) so crossing hands never swap roles.
   */
  private assignRoles(points: { x: number; y: number }[]): HandRole[] {
    if (points.length === 0) return [];
    if (points.length === 1) {
      if (this.present.control && !this.present.play) {
        const c = this.tracks.control;
        const near = Math.hypot(points[0].x - c.lastX, points[0].y - c.lastY) < 0.15;
        if (near) return ['control'];
      }
      return ['play'];
    }
    if (this.present.play && this.present.control) {
      const p = this.tracks.play;
      const ex = p.lastX + p.vx;
      const ey = p.lastY + p.vy;
      const d0 = Math.hypot(points[0].x - ex, points[0].y - ey);
      const d1 = Math.hypot(points[1].x - ex, points[1].y - ey);
      return d0 <= d1 ? ['play', 'control'] : ['control', 'play'];
    }
    const playFirst = this.lefty ? points[0].x < points[1].x : points[0].x > points[1].x;
    return playFirst ? ['play', 'control'] : ['control', 'play'];
  }
}

/** Time a pose must be held to count as a deliberate command (e.g. open palm → record). */
export class Dwell {
  private since: number | null = null;
  private fired = false;
  constructor(readonly holdMs = 900) {}

  /** Returns progress 0..1 and whether this update completed the hold. */
  update(active: boolean, tMs: number): { progress: number; fired: boolean } {
    if (!active) {
      this.since = null;
      this.fired = false;
      return { progress: 0, fired: false };
    }
    if (this.since === null) this.since = tMs;
    const progress = Math.min(1, (tMs - this.since) / this.holdMs);
    if (progress >= 1 && !this.fired) {
      this.fired = true;
      return { progress, fired: true };
    }
    return { progress: this.fired ? 1 : progress, fired: false };
  }
}
