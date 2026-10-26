import { Dwell, type GestureFrame, type HandState } from './interpret';

export type GestureCommand =
  | { readonly type: 'noteOn'; readonly degree: number; readonly velocity: number }
  | { readonly type: 'glide'; readonly degree: number; readonly velocity: number }
  /** Pitch settled just after the pinch: replace the note rather than add a new one. */
  | { readonly type: 'retune'; readonly degree: number; readonly velocity: number }
  | { readonly type: 'noteOff' }
  | { readonly type: 'toggleRecord' }
  | { readonly type: 'grab'; readonly x: number; readonly y: number }
  | { readonly type: 'drag'; readonly x: number; readonly y: number }
  | { readonly type: 'stretch'; readonly factor: number }
  | { readonly type: 'drop' };

export type InstrumentMode = 'perform' | 'sculpt';

/** After a pinch starts, pitch changes within this window retune the note instead of gliding. */
export const SETTLE_MS = 120;

/** Vertical band of the camera frame that maps onto the pitch rail. */
export const PLAY_ZONE = { top: 0.12, bottom: 0.88 } as const;

export interface PitchRange {
  readonly lo: number;
  readonly hi: number;
}

/** Continuous rail position (0 = bottom/lowest, 1 = top/highest) from a screen y. */
export function railPosition(y: number): number {
  const n = (y - PLAY_ZONE.top) / (PLAY_ZONE.bottom - PLAY_ZONE.top);
  return 1 - Math.min(1, Math.max(0, n));
}

/** Degree with hysteresis: the boundary must be crossed by 15% of a step before the pitch changes. */
export function degreeFromPosition(position: number, range: PitchRange, current: number | null): number {
  const steps = range.hi - range.lo;
  const cont = range.lo + position * steps;
  if (current !== null && Math.abs(cont - current) < 0.65) return current;
  return Math.min(range.hi, Math.max(range.lo, Math.round(cont)));
}

/** Leaning in plays louder: palm size → velocity. */
export function velocityFromSize(size: number): number {
  const n = (size - 0.08) / (0.22 - 0.08);
  return 0.5 + 0.5 * Math.min(1, Math.max(0, n));
}

export interface GestureOutput {
  readonly commands: GestureCommand[];
  /** Open-palm record hold progress, 0..1. */
  readonly recordHold: number;
  readonly degree: number | null;
}

/**
 * Turns gesture frames into instrument commands. Owns only gesture-level
 * state (is a note held, which degree, is a phrase grabbed); the app applies
 * the commands to the same functions pointer input uses.
 */
export class GestureController {
  private sounding = false;
  private soundingSince = 0;
  private degree: number | null = null;
  private grabbing = false;
  private stretchStart: number | null = null;
  private dwell = new Dwell(900);

  reset(): GestureCommand[] {
    const out: GestureCommand[] = [];
    if (this.sounding) out.push({ type: 'noteOff' });
    if (this.grabbing) out.push({ type: 'drop' });
    this.sounding = false;
    this.grabbing = false;
    this.degree = null;
    this.stretchStart = null;
    return out;
  }

  update(frame: GestureFrame, mode: InstrumentMode, range: PitchRange): GestureOutput {
    const commands: GestureCommand[] = [];
    const play = frame.play;
    const control = frame.control;

    // Control hand: hold an open palm to toggle recording (works in both modes).
    const hold = this.dwell.update(!!control?.open, frame.t);
    if (hold.fired) commands.push({ type: 'toggleRecord' });

    if (mode === 'perform') {
      if (this.grabbing) commands.push(...this.endGrab());
      this.perform(play, range, commands, frame.t);
    } else {
      if (this.sounding) {
        commands.push({ type: 'noteOff' });
        this.sounding = false;
      }
      this.sculpt(play, control, commands);
    }
    return { commands, recordHold: hold.progress, degree: this.degree };
  }

  private perform(play: HandState | null, range: PitchRange, out: GestureCommand[], t: number): void {
    if (!play) {
      if (this.sounding) out.push({ type: 'noteOff' });
      this.sounding = false;
      this.degree = null;
      return;
    }
    const next = degreeFromPosition(railPosition(play.y), range, this.degree);
    const velocity = velocityFromSize(play.size);
    if (play.pinched && !this.sounding) {
      this.sounding = true;
      this.soundingSince = t;
      out.push({ type: 'noteOn', degree: next, velocity });
    } else if (play.pinched && this.sounding && next !== this.degree) {
      out.push({ type: t - this.soundingSince < SETTLE_MS ? 'retune' : 'glide', degree: next, velocity });
    } else if (!play.pinched && this.sounding) {
      this.sounding = false;
      out.push({ type: 'noteOff' });
    }
    this.degree = next;
  }

  private sculpt(play: HandState | null, control: HandState | null, out: GestureCommand[]): void {
    if (!play || !play.pinched) {
      if (this.grabbing) out.push(...this.endGrab());
      return;
    }
    if (!this.grabbing) {
      this.grabbing = true;
      out.push({ type: 'grab', x: play.x, y: play.y });
      return;
    }
    if (control?.pinched) {
      const d = Math.hypot(play.x - control.x, play.y - control.y);
      if (this.stretchStart === null) this.stretchStart = Math.max(0.02, d);
      out.push({ type: 'stretch', factor: d / this.stretchStart });
    } else {
      this.stretchStart = null;
      out.push({ type: 'drag', x: play.x, y: play.y });
    }
  }

  private endGrab(): GestureCommand[] {
    this.grabbing = false;
    this.stretchStart = null;
    return [{ type: 'drop' }];
  }
}
