import { expect, test } from '@playwright/test';
import { E2E, project, state, waitForBeat } from './helpers';

async function openDemo(page: import('@playwright/test').Page) {
  await page.goto(E2E);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('open-demo').click();
  await expect(page.getByTestId('spool-canvas')).toBeVisible();
}

const voices = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __spool: { engine: () => { activeVoices: number } } }).__spool.engine().activeVoices);

test('stop silences every queued and sounding voice', async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press('Space');
  await waitForBeat(page, 0.3, 0.6); // pad chord + bass + pluck sounding
  expect(await voices(page)).toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Space');
  // fast release is 60 ms; give the nodes a moment to report ended
  await expect.poll(() => voices(page), { timeout: 1500 }).toBe(0);
});

test('Tab moves focus through controls; Enter mutes a thread from the keyboard', async ({ page }) => {
  await openDemo(page);
  const mode = await state<string>(page, 'mode');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await state<string>(page, 'mode')).toBe(mode); // Tab no longer hijacked
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(['BUTTON', 'INPUT']).toContain(focused);

  await page.getByTestId('mute-bass').focus();
  await page.keyboard.press('Enter');
  expect((await project(page)).tracks.bass.muted).toBe(true);
  expect(await state<string>(page, 'activeTrack')).toBe('pluck'); // muting did not select the row
  await page.keyboard.press('Space'); // keyboard-focused button: Space activates it, not play
  expect((await project(page)).tracks.bass.muted).toBe(false);
  expect(await state<boolean>(page, 'playing')).toBe(false);
});

test('after clicking a button with the mouse, Space still means play/stop', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('mute-glass').click();
  await page.keyboard.press('Space');
  expect(await state<boolean>(page, 'playing')).toBe(true);
  expect((await project(page)).tracks.glass.muted).toBe(true); // not toggled back by Space
  await page.keyboard.press('Space');
  expect(await state<boolean>(page, 'playing')).toBe(false);
});

test('E toggles sculpt mode', async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press('e');
  expect(await state<string>(page, 'mode')).toBe('sculpt');
  await page.keyboard.press('e');
  expect(await state<string>(page, 'mode')).toBe('perform');
});
