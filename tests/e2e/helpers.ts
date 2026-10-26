import { expect, type Page } from '@playwright/test';
import type { Note, Project } from '../../src/music/types';
import type { HandSpec } from '../fixtures/hands';
import { makeHand } from '../fixtures/hands';

export const E2E = process.env.E2E_PROD === '1' ? '/?e2e' : '/';

export async function freshInstrument(page: Page, input: 'pointer' | 'camera' = 'pointer'): Promise<void> {
  await page.goto(E2E);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId(input === 'pointer' ? 'start-pointer' : 'start-camera').click();
  await expect(page.getByTestId('spool-canvas')).toBeVisible();
  await page.waitForFunction(() => (window as unknown as { __spool: { stage: () => unknown } }).__spool.stage() !== null);
}

export function project(page: Page): Promise<Project> {
  return page.evaluate(() => (window as unknown as { __spool: { project: () => Project } }).__spool.project());
}

export function state<T>(page: Page, pick: string): Promise<T> {
  return page.evaluate((k) => (window as unknown as { __spool: { state: () => Record<string, unknown> } }).__spool.state()[k] as T, pick);
}

/** Hold a home-row key for `ms`. */
export async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Wait until the transport loop position is within [from, to) beats. */
export async function waitForBeat(page: Page, from: number, to: number): Promise<void> {
  await page.waitForFunction(
    ([a, b]) => {
      const e = (window as unknown as { __spool: { engine: () => { position: number; playing: boolean } | null } }).__spool.engine();
      return !!e && e.playing && e.position >= a && e.position < b;
    },
    [from, to],
    { polling: 5 },
  );
}

export async function notePoint(page: Page, note: Note, along = 0.5): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(
    ([id, f]) => (window as unknown as { __spool: { notePoint: (id: string, f: number) => { x: number; y: number } | null } }).__spool.notePoint(id as string, f as number),
    [note.id, along] as const,
  );
  if (!p) throw new Error(`note ${note.id} not on stage`);
  return p;
}

/** Feed a sequence of synthetic hand frames through the real gesture entry point. */
export async function feedHands(page: Page, frames: HandSpec[][], startMs = 0, stepMs = 33): Promise<void> {
  const payload = frames.map((hands) => hands.map((h) => makeHand(h)));
  await page.evaluate(
    ([data, t0, dt]) => {
      const w = window as unknown as { __spool: { feedHands: (h: unknown, t: number) => void } };
      (data as unknown[]).forEach((hands, i) => w.__spool.feedHands(hands, (t0 as number) + i * (dt as number)));
    },
    [payload, startMs, stepMs] as const,
  );
}
