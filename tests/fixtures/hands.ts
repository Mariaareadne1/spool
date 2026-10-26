/**
 * Synthetic MediaPipe-shaped hands. Coordinates are in *camera image* space
 * (unmirrored, 0..1), exactly what HandLandmarker returns, so fixtures travel
 * the same code path as real tracking.
 */
import type { Landmark, RawHand } from '../../src/gesture/interpret';

export type Pose = 'open' | 'pinch' | 'fist' | 'relaxed';

// Template right hand, palm facing camera, wrist at origin, palm size = 1 (wrist → middle MCP).
// Units: palm lengths; y grows downward like image space.
const BASE: Record<string, [number, number]> = {
  wrist: [0, 0],
  thumbCmc: [-0.35, -0.2], thumbMcp: [-0.6, -0.45], thumbIp: [-0.75, -0.7],
  indexMcp: [-0.28, -0.95], middleMcp: [0, -1], ringMcp: [0.24, -0.95], pinkyMcp: [0.45, -0.82],
};

function finger(mcp: [number, number], dir: [number, number], len: number, curl: number): [number, number][] {
  // curl 0 = straight along dir; 1 = folded back toward the palm
  const pts: [number, number][] = [];
  let [x, y] = mcp;
  let angle = Math.atan2(dir[1], dir[0]);
  const seg = len / 3;
  for (let i = 0; i < 3; i++) {
    angle += curl * 1.2;
    x += Math.cos(angle) * seg;
    y += Math.sin(angle) * seg;
    pts.push([x, y]);
  }
  return pts;
}

function template(pose: Pose): [number, number][] {
  const curl = pose === 'fist' ? 1.15 : pose === 'relaxed' ? 0.35 : 0;
  const up: [number, number] = [0, -1];
  const index = pose === 'pinch' ? [[-0.45, -1.3], [-0.6, -1.45], [-0.72, -1.1]] as [number, number][] : finger(BASE.indexMcp, [-0.12, -1], 0.85, curl);
  const thumbTip: [number, number] = pose === 'pinch' ? [-0.78, -1.02] : pose === 'fist' ? [-0.3, -0.75] : [-0.9, -0.95];
  return [
    BASE.wrist,
    BASE.thumbCmc, BASE.thumbMcp, BASE.thumbIp, thumbTip,
    BASE.indexMcp, ...index,
    BASE.middleMcp, ...finger(BASE.middleMcp, up, 0.95, curl),
    BASE.ringMcp, ...finger(BASE.ringMcp, [0.1, -1], 0.88, curl),
    BASE.pinkyMcp, ...finger(BASE.pinkyMcp, [0.25, -1], 0.7, curl),
  ];
}

export interface HandSpec {
  /** Pinch point in *screen* (mirrored) space, 0..1. */
  readonly x: number;
  readonly y: number;
  readonly pose: Pose;
  /** Palm size in image units. */
  readonly size?: number;
}

/** Build a hand whose pinch point lands at (x, y) in mirrored screen space. */
export function makeHand(spec: HandSpec): RawHand {
  const size = spec.size ?? 0.14;
  const pts = template(spec.pose);
  const pinchMid: [number, number] = [(pts[4][0] + pts[8][0]) / 2, (pts[4][1] + pts[8][1]) / 2];
  // image-space target of the pinch point (unmirror x)
  const tx = 1 - spec.x;
  const ty = spec.y;
  const landmarks: Landmark[] = pts.map(([px, py]) => ({
    // mirror the template so a right hand looks right-handed in the camera image
    x: tx - (px - pinchMid[0]) * size,
    y: ty + (py - pinchMid[1]) * size,
    z: 0,
  }));
  return { landmarks };
}
