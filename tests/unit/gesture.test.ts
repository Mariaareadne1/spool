import { describe, expect, test } from 'vitest';
import { Dwell, GestureInterpreter, measureHand, OneEuro, PINCH_OFF, PINCH_ON } from '../../src/gesture/interpret';
import { degreeFromPosition, GestureController, railPosition, velocityFromSize } from '../../src/gesture/controller';
import { makeHand, type Pose } from '../fixtures/hands';

const RANGE = { lo: 0, hi: 14 };

describe('synthetic fixtures measure like real hands', () => {
  test.each<[Pose, (m: ReturnType<typeof measureHand>) => boolean]>([
    ['open', (m) => m.pinchRatio > PINCH_OFF && m.openness > 1.75],
    ['pinch', (m) => m.pinchRatio < PINCH_ON],
    ['fist', (m) => m.openness < 1.4],
  ])('%s pose', (pose, check) => {
    expect(check(measureHand(makeHand({ x: 0.6, y: 0.5, pose }).landmarks))).toBe(true);
  });

  test('pinch point is mirrored into screen space', () => {
    const m = measureHand(makeHand({ x: 0.7, y: 0.3, pose: 'pinch' }).landmarks);
    expect(m.px).toBeCloseTo(0.7, 5);
    expect(m.py).toBeCloseTo(0.3, 5);
  });

  test('measurements are scale invariant (near vs far)', () => {
    const near = measureHand(makeHand({ x: 0.5, y: 0.5, pose: 'pinch', size: 0.25 }).landmarks);
    const far = measureHand(makeHand({ x: 0.5, y: 0.5, pose: 'pinch', size: 0.07 }).landmarks);
    expect(near.pinchRatio).toBeCloseTo(far.pinchRatio, 5);
  });
});

describe('interpreter', () => {
  test('pinch hysteresis: no chatter at the threshold', () => {
    const gi = new GestureInterpreter();
    let t = 0;
    const states: boolean[] = [];
    for (const pose of ['open', 'pinch', 'pinch', 'relaxed', 'pinch', 'open'] as Pose[]) {
      states.push(gi.process([makeHand({ x: 0.6, y: 0.5, pose })], (t += 33)).play!.pinched);
    }
    expect(states).toEqual([false, true, true, states[3], true, false]);
  });

  test('two hands: the right-hand side of the mirror plays; roles stick when hands cross', () => {
    const gi = new GestureInterpreter();
    const f1 = gi.process([makeHand({ x: 0.25, y: 0.5, pose: 'open' }), makeHand({ x: 0.75, y: 0.5, pose: 'pinch' })], 0);
    expect(f1.play!.x).toBeCloseTo(0.75, 2);
    expect(f1.control!.open).toBe(true);
    // move hands gradually toward and past each other
    let f = f1;
    for (let i = 1; i <= 20; i++) {
      const a = 0.25 + i * 0.03;
      const b = 0.75 - i * 0.03;
      f = gi.process([makeHand({ x: a, y: 0.5, pose: 'open' }), makeHand({ x: b, y: 0.5, pose: 'pinch' })], i * 33);
    }
    expect(f.play!.pinched).toBe(true); // still the pinching hand, now on the left
    expect(f.play!.x).toBeLessThan(0.5);
  });

  test('lefty swaps the default play side', () => {
    const gi = new GestureInterpreter(true);
    const f = gi.process([makeHand({ x: 0.25, y: 0.5, pose: 'pinch' }), makeHand({ x: 0.75, y: 0.5, pose: 'open' })], 0);
    expect(f.play!.x).toBeCloseTo(0.25, 2);
  });

  test('One-Euro filter smooths jitter but follows a real move', () => {
    const f = new OneEuro();
    let out = 0;
    for (let i = 0; i < 30; i++) out = f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i * 16);
    expect(Math.abs(out - 0.5)).toBeLessThan(0.006);
    for (let i = 30; i < 60; i++) out = f.filter(0.9, i * 16);
    expect(out).toBeGreaterThan(0.88);
  });
});

describe('controller → instrument commands', () => {
  function run(frames: Array<{ hands: Parameters<typeof makeHand>[0][] }>, mode: 'perform' | 'sculpt' = 'perform') {
    const gi = new GestureInterpreter();
    const gc = new GestureController();
    const cmds: string[] = [];
    frames.forEach((fr, i) => {
      const out = gc.update(gi.process(fr.hands.map(makeHand), i * 33), mode, RANGE);
      for (const c of out.commands) cmds.push('degree' in c ? `${c.type}:${c.degree}` : c.type);
    });
    return cmds;
  }

  test('pinch plays, height sets pitch, moving while pinched glides, opening releases', () => {
    const top = 0.12;
    const bottom = 0.88;
    const cmds = run([
      { hands: [{ x: 0.6, y: bottom, pose: 'open' }] },
      { hands: [{ x: 0.6, y: bottom, pose: 'pinch' }] },
      ...Array.from({ length: 12 }, () => ({ hands: [{ x: 0.6, y: top, pose: 'pinch' as Pose }] })),
      { hands: [{ x: 0.6, y: top, pose: 'open' }] },
    ]);
    expect(cmds[0]).toBe('noteOn:0');
    expect(cmds.at(-1)).toBe('noteOff');
    expect(cmds.filter((c) => c.startsWith('glide')).at(-1)).toBe('glide:14');
  });

  test('losing the hand releases the note', () => {
    expect(run([{ hands: [{ x: 0.6, y: 0.5, pose: 'pinch' }] }, { hands: [] }])).toEqual(['noteOn:7', 'noteOff']);
  });

  test('open control palm held ~1 s toggles record exactly once', () => {
    const frames = Array.from({ length: 45 }, () => ({ hands: [{ x: 0.2, y: 0.5, pose: 'open' as Pose }, { x: 0.8, y: 0.5, pose: 'relaxed' as Pose }] }));
    expect(run(frames).filter((c) => c === 'toggleRecord')).toHaveLength(1);
  });

  test('sculpt: pinch grabs, moving drags, second-hand pinch stretches, release drops', () => {
    const cmds = run([
      { hands: [{ x: 0.6, y: 0.5, pose: 'pinch' }] },
      { hands: [{ x: 0.62, y: 0.5, pose: 'pinch' }] },
      { hands: [{ x: 0.3, y: 0.5, pose: 'pinch' }, { x: 0.62, y: 0.5, pose: 'pinch' }] },
      { hands: [{ x: 0.25, y: 0.5, pose: 'pinch' }, { x: 0.7, y: 0.5, pose: 'pinch' }] },
      { hands: [{ x: 0.7, y: 0.5, pose: 'open' }] },
    ], 'sculpt');
    expect(cmds).toEqual(['grab', 'drag', 'stretch', 'stretch', 'drop']);
  });

  test('pure helpers', () => {
    expect(railPosition(0)).toBe(1);
    expect(railPosition(1)).toBe(0);
    expect(degreeFromPosition(0.5, RANGE, null)).toBe(7);
    expect(degreeFromPosition(0.53, RANGE, 7)).toBe(7); // hysteresis holds
    expect(degreeFromPosition(0.56, RANGE, 7)).toBe(8);
    expect(velocityFromSize(0.3)).toBe(1);
    expect(velocityFromSize(0.01)).toBe(0.5);
  });

  test('dwell resets when the pose breaks', () => {
    const d = new Dwell(100);
    d.update(true, 0);
    expect(d.update(false, 50).progress).toBe(0);
    d.update(true, 60);
    expect(d.update(true, 170).fired).toBe(true);
    expect(d.update(true, 300).fired).toBe(false);
  });
});

describe('pinch settle', () => {
  test('pitch change right after the pinch retunes; later changes glide', async () => {
    const { GestureController } = await import('../../src/gesture/controller');
    const gi = new GestureInterpreter();
    const gc = new GestureController();
    const types: string[] = [];
    const feed = (y: number, pose: Pose, t: number) => gc.update(gi.process([makeHand({ x: 0.6, y, pose })], t), 'perform', RANGE).commands.forEach((c) => types.push(c.type));
    feed(0.5, 'open', 0);
    feed(0.5, 'pinch', 33);
    feed(0.2, 'pinch', 66); // jump within the settle window
    for (let i = 0; i < 6; i++) feed(0.2, 'pinch', 99 + i * 33);
    feed(0.8, 'pinch', 600); // deliberate move later
    for (let i = 0; i < 6; i++) feed(0.8, 'pinch', 633 + i * 33);
    expect(types[0]).toBe('noteOn');
    expect(types.slice(1, types.indexOf('glide'))).not.toContain('glide');
    expect(types).toContain('retune');
    expect(types).toContain('glide');
  });
});
