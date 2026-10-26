import { expect, test } from '@playwright/test';
import type { HandSpec, Pose } from '../fixtures/hands';
import { E2E, feedHands, freshInstrument, notePoint, project, state } from './helpers';

const repeat = (n: number, hands: HandSpec[]): HandSpec[][] => Array.from({ length: n }, () => hands);
const hand = (x: number, y: number, pose: Pose): HandSpec => ({ x, y, pose });

/**
 * Synthetic MediaPipe landmarks travel the same path as camera frames:
 * __spool.feedHands → GestureInterpreter → GestureController → SpoolApp.
 * These verify the gesture logic in the real app; human ergonomics need a person.
 */
test.describe('gestures (synthetic landmarks through the real pipeline)', () => {
  test('pinch plays, hand height chooses pitch, opening releases', async ({ page }) => {
    await freshInstrument(page);
    let t = 0;
    // low hand pinches → lowest degree
    await feedHands(page, repeat(3, [hand(0.6, 0.86, 'open')]), t);
    await feedHands(page, repeat(4, [hand(0.6, 0.86, 'pinch')]), (t += 200));
    let held = await state<{ degree: number; source: string }[]>(page, 'held');
    expect(held).toHaveLength(1);
    expect(held[0].source).toBe('gesture');
    expect(held[0].degree).toBe(0);
    // raise the pinched hand to the top → glide to the highest degree (dorian: 14)
    await feedHands(page, repeat(12, [hand(0.6, 0.12, 'pinch')]), (t += 200));
    held = await state(page, 'held');
    expect(held).toHaveLength(1);
    expect(held[0].degree).toBe(14);
    // open the hand → silence
    await feedHands(page, repeat(3, [hand(0.6, 0.12, 'open')]), (t += 500));
    expect(await state<unknown[]>(page, 'held')).toHaveLength(0);
    // lose the hand mid-note → note released, no stuck voice
    await feedHands(page, repeat(3, [hand(0.6, 0.5, 'pinch')]), (t += 300));
    expect(await state<unknown[]>(page, 'held')).toHaveLength(1);
    await feedHands(page, [[]], (t += 200));
    expect(await state<unknown[]>(page, 'held')).toHaveLength(0);
  });

  test('open palm held with the other hand records a phrase of pinched notes', async ({ page }) => {
    await freshInstrument(page);
    let t = 0;
    const playHand = hand(0.72, 0.6, 'relaxed');
    // ~1 s open control palm → toggles recording on
    await feedHands(page, repeat(32, [hand(0.25, 0.5, 'open'), playHand]), t);
    await expect.poll(() => state<boolean>(page, 'recording')).toBe(true);
    // lower the control hand (fist), play three pinched notes in real time
    for (const y of [0.8, 0.6, 0.4]) {
      await feedHands(page, repeat(2, [hand(0.25, 0.7, 'fist'), hand(0.72, y, 'pinch')]), (t += 1200));
      await page.waitForTimeout(350);
      await feedHands(page, repeat(2, [hand(0.25, 0.7, 'fist'), hand(0.72, y, 'open')]), (t += 400));
      await page.waitForTimeout(150);
    }
    // palm again → stop recording
    await feedHands(page, repeat(32, [hand(0.25, 0.5, 'open'), hand(0.72, 0.6, 'relaxed')]), (t += 1000));
    await expect.poll(() => state<boolean>(page, 'recording')).toBe(false);
    const p = await project(page);
    expect(p.phrases).toHaveLength(1);
    const degrees = p.notes.slice().sort((a, b) => a.start - b.start).map((n) => n.degree);
    expect(degrees).toHaveLength(3);
    expect(degrees[0]).toBeLessThan(degrees[1]);
    expect(degrees[1]).toBeLessThan(degrees[2]);
  });

  test('sculpt: pinch a thread to grab, move to transpose, spread two pinches to stretch', async ({ page }) => {
    await page.goto(E2E);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByTestId('open-demo').click();
    await page.getByTestId('mode-sculpt').click();
    const before = await project(page);
    const target = before.notes.find((n) => n.track === 'pluck' && n.duration >= 1)!;
    // convert the note's screen point into the hand's normalised camera coordinates
    const pt = await notePoint(page, target, 0.5);
    const norm = await page.evaluate(([x, y]) => {
      const w = window as unknown as { __spool: { stage: () => { size: number } } };
      const c = document.querySelector('[data-testid="spool-canvas"]')!.getBoundingClientRect();
      const s = w.__spool.stage().size;
      return { x: 0.1 + ((x - c.left) / s) * 0.8, y: 0.1 + ((y - c.top) / s) * 0.8 };
    }, [pt.x, pt.y] as const);
    let t = 0;
    await feedHands(page, repeat(2, [hand(norm.x, norm.y, 'open')]), t);
    await feedHands(page, repeat(3, [hand(norm.x, norm.y, 'pinch')]), (t += 100));
    expect(await state<string | null>(page, 'selection')).toBe(target.phraseId);
    // move outward from the centre (radially) by ~3 steps
    const step = await page.evaluate(() => {
      const w = window as unknown as { __spool: { stage: () => { size: number; layout: { band: number; cx: number; cy: number } } } };
      const s = w.__spool.stage();
      return { n: ((s.layout.band * 0.86) / 14 / s.size) * 0.8, cx: 0.1 + (s.layout.cx / s.size) * 0.8, cy: 0.1 + (s.layout.cy / s.size) * 0.8 };
    });
    const dx = norm.x - step.cx;
    const dy = norm.y - step.cy;
    const len = Math.hypot(dx, dy);
    const out = { x: norm.x + (dx / len) * step.n * 3, y: norm.y + (dy / len) * step.n * 3 };
    await feedHands(page, repeat(12, [hand(out.x, out.y, 'pinch')]), (t += 100));
    const edit = await state<{ steps: number; beats: number }>(page, 'edit');
    expect(edit.steps).toBe(3);
    // second hand pinches and spreads → stretch snaps to ×2
    await feedHands(page, repeat(3, [hand(out.x, out.y, 'pinch'), hand(out.x - 0.15, out.y, 'pinch')]), (t += 500));
    await feedHands(page, repeat(6, [hand(out.x, out.y, 'pinch'), hand(out.x - 0.3, out.y, 'pinch')]), (t += 120));
    expect((await state<{ factor: number }>(page, 'edit')).factor).toBe(2);
    // release → one committed edit
    await feedHands(page, repeat(3, [hand(out.x, out.y, 'open')]), (t += 300));
    const after = await project(page);
    const was = before.notes.filter((n) => n.phraseId === target.phraseId);
    const now = after.notes.filter((n) => n.phraseId === target.phraseId);
    expect(now.map((n) => n.degree)).toEqual(was.map((n) => n.degree + 3));
    expect(now.reduce((s, n) => s + n.duration, 0)).toBeGreaterThan(was.reduce((s, n) => s + n.duration, 0) * 1.6);
    await page.keyboard.press('ControlOrMeta+z');
    expect((await project(page)).notes).toEqual(before.notes);
  });
});

test.describe('camera states (Chromium fake camera, real MediaPipe)', () => {
  test('permission → model loading → running → no-hands coaching', async ({ page }) => {
    await page.goto(E2E);
    await page.getByTestId('start-camera').click();
    await expect(page.getByTestId('camera-view')).toBeVisible();
    // the fake device has no hands in it; the real tracker must load and say so
    await expect.poll(() => state<{ kind: string }>(page, 'tracker').then((s) => s.kind), { timeout: 45_000 }).toBe('running');
    await expect(page.getByTestId('no-hands')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('camera-view')).toContainText('no hands');
  });

  test('declined permission falls back to pointer & keys', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      });
    });
    await page.goto(E2E);
    await page.getByTestId('start-camera').click();
    await expect(page.getByTestId('camera-error')).toContainText('Camera declined');
    await page.getByTestId('camera-fallback').click();
    await expect(page.getByTestId('camera-error')).toHaveCount(0);
    expect(await state<string>(page, 'input')).toBe('pointer');
  });
});
