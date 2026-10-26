import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { E2E, notePoint, project, waitForBeat } from './helpers';

/**
 * Drives the app into each design state at each target viewport, asserts the
 * layout never scrolls sideways, and saves full-resolution screenshots for
 * review (artifacts/states) — the case study picks from these.
 */
const OUT = 'artifacts/states';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [390, 844],
] as const;

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(iw);
}

async function shot(page: Page, name: string, w: number, h: number) {
  await page.screenshot({ path: `${OUT}/${name}-${w}x${h}.png` });
}

for (const [w, h] of VIEWPORTS) {
  test(`states @ ${w}×${h}`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.goto(E2E);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(1500); // entrance animation
    await noHorizontalScroll(page);
    await shot(page, '01-landing', w, h);

    await page.getByTestId('start-pointer').click();
    await page.waitForTimeout(400);
    await noHorizontalScroll(page);
    await shot(page, '02-empty', w, h);

    // demo, playing, with a held note
    await page.goto(E2E);
    await page.getByTestId('open-demo').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');
    await waitForBeat(page, 2.3, 2.6);
    await page.keyboard.down('k');
    await page.waitForTimeout(250);
    await noHorizontalScroll(page);
    await shot(page, '03-playing', w, h);
    await page.keyboard.up('k');

    // recording
    await page.keyboard.press('r');
    await page.keyboard.down('h');
    await page.waitForTimeout(500);
    await shot(page, '04-recording', w, h);
    await page.keyboard.up('h');
    await page.keyboard.press('r');
    await page.keyboard.press('Space');

    // sculpt: selection, then mid-drag
    await page.getByTestId('mode-sculpt').click();
    const p = await project(page);
    const target = p.notes.find((n) => n.track === 'pluck' && n.duration >= 1)!;
    const pt = await notePoint(page, target, 0.5);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
    await noHorizontalScroll(page);
    await shot(page, '05-sculpt-selected', w, h);
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(pt.x + i * 4, pt.y - i * 5);
    await page.waitForTimeout(150);
    await shot(page, '06-sculpt-dragging', w, h);
    await page.mouse.up();

    if (w >= 1024) {
      await page.getByTestId('export-menu').click();
      await page.waitForTimeout(250);
      await shot(page, '07-export-menu', w, h);
      await page.keyboard.press('Escape');
    }
    await page.close();
  });
}

test('camera states @ 1440×900', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, permissions: ['camera'] });
  await page.goto(E2E);
  await page.getByTestId('start-camera').click();
  await page.getByTestId('camera-loading').waitFor({ timeout: 20_000 }).catch(() => undefined);
  await shot(page, '08-camera-loading', 1440, 900);
  await expect(page.getByTestId('no-hands')).toBeVisible({ timeout: 45_000 });
  await shot(page, '09-camera-no-hands', 1440, 900);
  await page.close();

  const denied = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await denied.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('no', 'NotAllowedError')) });
  });
  await denied.goto(E2E);
  await denied.getByTestId('start-camera').click();
  await expect(denied.getByTestId('camera-error')).toBeVisible();
  await shot(denied, '10-camera-denied', 1440, 900);
  await denied.close();
});
