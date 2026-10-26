// Full-resolution screenshots for visual QA and the case study.
// Usage: node scripts/shoot.mjs <url> <outDir> [name] [WxH ...]
import { chromium } from '@playwright/test';

const [url = 'http://localhost:5341/', out = 'case-study/screenshots', name = 'shot', ...sizes] = process.argv.slice(2);
const viewports = (sizes.length ? sizes : ['1440x900']).map((s) => s.split('x').map(Number));
const browser = await chromium.launch({ args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
for (const [width, height] of viewports) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.waitForTimeout(1500);
  const file = `${out}/${name}-${width}x${height}.png`;
  await page.screenshot({ path: file });
  console.log(file);
  await page.close();
}
await browser.close();
