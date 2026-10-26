import { SCALES, mod } from '../music/theory';
import { loopBeats, type Note, type Project, type TrackId } from '../music/types';

/**
 * The spool's polar coordinate system. Angle is time (12 o'clock = beat 1,
 * clockwise), the ring is the track (low voices inside, high outside) and the
 * radius within a ring is pitch. Drawing and hit-testing both go through here,
 * so what you grab is exactly what you see.
 */

/** Inside → outside. */
export const RING_ORDER: readonly TrackId[] = ['bass', 'pad', 'pluck', 'glass'];

export interface Layout {
  readonly cx: number;
  readonly cy: number;
  readonly outer: number;
  readonly hub: number;
  readonly bandInner: number;
  readonly bandOuter: number;
  readonly band: number;
}

export function layoutFor(size: number): Layout {
  const outer = size * 0.47;
  const hub = outer * 0.2;
  const bandInner = hub + outer * 0.04;
  const bandOuter = outer * 0.875;
  return { cx: size / 2, cy: size / 2, outer, hub, bandInner, bandOuter, band: (bandOuter - bandInner) / RING_ORDER.length };
}

/** Playable degree range for a scale: two octaves plus the top tonic. */
export function pitchRange(project: Pick<Project, 'scale'>): { lo: number; hi: number } {
  return { lo: 0, hi: SCALES[project.scale].length * 2 };
}

export function ringIndex(track: TrackId): number {
  return RING_ORDER.indexOf(track);
}

export function ringBounds(l: Layout, track: TrackId): { inner: number; outer: number } {
  const i = ringIndex(track);
  return { inner: l.bandInner + i * l.band, outer: l.bandInner + (i + 1) * l.band };
}

/** Radial distance between adjacent degrees in a ring. */
export function stepSize(l: Layout, project: Pick<Project, 'scale'>): number {
  const { lo, hi } = pitchRange(project);
  return (l.band * 0.86) / (hi - lo);
}

export function degreeRadius(l: Layout, project: Pick<Project, 'scale'>, track: TrackId, degree: number): number {
  const { lo, hi } = pitchRange(project);
  const { inner } = ringBounds(l, track);
  const clamped = Math.min(hi + 2, Math.max(lo - 2, degree));
  return inner + l.band * 0.07 + (clamped - lo) * stepSize(l, project);
}

export function beatAngle(beat: number, loop: number): number {
  return -Math.PI / 2 + (2 * Math.PI * beat) / loop;
}

export interface Polar {
  readonly r: number;
  /** Loop beat under the point, 0..loop. */
  readonly beat: number;
  readonly theta: number;
}

export function toPolar(l: Layout, x: number, y: number, loop: number): Polar {
  const dx = x - l.cx;
  const dy = y - l.cy;
  const theta = Math.atan2(dy, dx);
  const beat = mod(((theta + Math.PI / 2) / (2 * Math.PI)) * loop, loop);
  return { r: Math.hypot(dx, dy), beat, theta };
}

/** Which track's ring a radius falls in, if any. */
export function trackAtRadius(l: Layout, r: number): TrackId | null {
  if (r < l.bandInner || r > l.bandOuter) return null;
  return RING_ORDER[Math.min(RING_ORDER.length - 1, Math.floor((r - l.bandInner) / l.band))];
}

function beatInNote(beat: number, note: Note, loop: number): boolean {
  const rel = mod(beat - note.start, loop);
  return rel <= note.duration;
}

/** Nearest note under a point, with a forgiving radial tolerance. */
export function hitTest(l: Layout, project: Project, x: number, y: number, tolerancePx = 10): Note | null {
  const loop = loopBeats(project);
  const p = toPolar(l, x, y, loop);
  // angular tolerance: same pixel distance along the arc
  const beatTol = (tolerancePx / Math.max(1, p.r)) * (loop / (2 * Math.PI));
  let best: Note | null = null;
  let bestDist = Infinity;
  for (const note of project.notes) {
    const r = degreeRadius(l, project, note.track, note.degree);
    const dr = Math.abs(p.r - r);
    if (dr > tolerancePx + stepSize(l, project) * 0.5) continue;
    const inside = beatInNote(p.beat, note, loop) || beatInNote(p.beat + beatTol, note, loop) || beatInNote(p.beat - beatTol, note, loop);
    if (!inside) continue;
    if (dr < bestDist) {
      bestDist = dr;
      best = note;
    }
  }
  return best;
}

/** Signed angular difference a→b in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

