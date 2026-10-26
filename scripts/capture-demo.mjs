// Records a real session with Playwright (video + the app's own WAV export).
// Usage: node scripts/capture-demo.mjs [baseUrl]   (dev server or `npm run preview`)
// Output: case-study/demos/session.webm, first-light.wav
import { chromium } from '@playwright/test';
import { mkdirSync, renameSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5341/';
const out = 'case-study/demos';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: out, size: { width: 1440, height: 900 } },
  acceptDownloads: true,
});
const page = await context.newPage();
const pos = () => page.evaluate(() => window.__spool.engine()?.position ?? -1);
const waitBeat = async (a, b) => page.waitForFunction(([x, y]) => { const e = window.__spool.engine(); return e && e.playing && e.position >= x && e.position < y; }, [a, b], { polling: 5 });

await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(2200); // landing entrance
await page.getByTestId('open-demo').click();
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForTimeout(5200); // one loop of First Light

// wind a new glass phrase over it
await page.keyboard.press('1');
await waitBeat(7.4, 7.7);
await page.keyboard.press('r');
for (const [beat, key, ms] of [[0.5, 'l', 280], [1.5, 'k', 280], [2.5, 'h', 500], [4.5, 'j', 280], [5.5, 'g', 700]]) {
  await waitBeat(beat, beat + 0.15);
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
await waitBeat(7, 7.3);
await page.keyboard.press('r');
await page.waitForTimeout(5400); // hear it back

// sculpt: grab the new phrase and drag it outward and around
await page.getByTestId('mode-sculpt').click();
await page.waitForTimeout(600);
const note = await page.evaluate(() => {
  const p = window.__spool.project();
  const ph = p.phrases.filter((x) => x.track === 'glass').at(-1);
  return p.notes.find((n) => n.phraseId === ph.id);
});
const pt = await page.evaluate((id) => window.__spool.notePoint(id, 0.5), note.id);
const c = await page.evaluate(() => { const r = document.querySelector('[data-testid="spool-canvas"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
const r0 = Math.hypot(pt.x - c.x, pt.y - c.y);
const a0 = Math.atan2(pt.y - c.y, pt.x - c.x);
await page.mouse.move(pt.x, pt.y, { steps: 10 });
await page.mouse.down();
for (let i = 1; i <= 40; i++) {
  const r = r0 - 14 * (i / 40);
  const a = a0 + (Math.PI / 4) * (i / 40);
  await page.mouse.move(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
  await page.waitForTimeout(30);
}
await page.waitForTimeout(500);
await page.mouse.up();
await page.waitForTimeout(4500);
await page.keyboard.press('Space');

// export through the real UI
await page.getByTestId('export-menu').click();
await page.waitForTimeout(500);
const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-wav').click()]);
await download.saveAs(`${out}/first-light.wav`);
await page.waitForTimeout(1800);
console.log('position at end', await pos());

const video = page.video();
await context.close();
await browser.close();
renameSync(await video.path(), `${out}/session.webm`);
console.log('wrote', `${out}/session.webm`, `${out}/first-light.wav`);
