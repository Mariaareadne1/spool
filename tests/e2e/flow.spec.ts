import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffprobe from 'ffprobe-static';
import { decodeWav } from '../../src/audio/wav';
import { centsBetween, detectOnsetsFlux, dominantFrequency, rms } from '../../src/audio/analysis';
import { noteFrequencies } from '../../src/audio/mix';
import type { Project } from '../../src/music/types';
import { E2E, freshInstrument, hold, notePoint, project, state, waitForBeat } from './helpers';

/**
 * The whole instrument, as a person would use it: play, record two layers,
 * sculpt a phrase, save, reload, export — then verify the WAV that came out.
 */
test('play → record two layers → sculpt → save → reload → export WAV', async ({ page }) => {
  await freshInstrument(page);

  // --- play a note from the rail (pointer) without recording
  const rail = page.getByTestId('rail');
  const box = (await rail.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
  await page.mouse.down();
  await expect.poll(() => state<unknown[]>(page, 'held').then((h) => h.length)).toBe(1);
  await page.mouse.up();
  await expect.poll(() => state<unknown[]>(page, 'held').then((h) => h.length)).toBe(0);
  expect((await project(page)).notes).toHaveLength(0);

  // --- record a pluck phrase with the keyboard, aligned to the loop
  await page.keyboard.press('Space'); // transport on
  await waitForBeat(page, 7.3, 7.6); // just before the loop wraps (2 bars = 8 beats)
  await page.keyboard.press('r');
  await waitForBeat(page, 0, 0.1);
  await hold(page, 'a', 250);
  await waitForBeat(page, 1, 1.1);
  await hold(page, 'd', 250);
  await waitForBeat(page, 2, 2.1);
  await hold(page, 'g', 250);
  await waitForBeat(page, 3, 3.1);
  await hold(page, 'k', 650);
  await waitForBeat(page, 4.5, 5);
  await page.keyboard.press('r');
  await expect(page.getByTestId('toast')).toContainText('Pluck phrase 1');

  let p = await project(page);
  const pluck = p.notes.filter((n) => n.track === 'pluck').sort((a, b) => a.start - b.start);
  expect(pluck.map((n) => n.degree)).toEqual([0, 2, 4, 7]);
  // onsets snapped to the 1/16 grid at the beats we played on
  expect(pluck.map((n) => n.start)).toEqual([0, 1, 2, 3]);
  expect(pluck[3].duration).toBeGreaterThan(pluck[0].duration);

  // --- second layer on the bass thread
  await page.keyboard.press('4');
  await waitForBeat(page, 7.3, 7.6);
  await page.keyboard.press('r');
  await waitForBeat(page, 0, 0.1);
  await hold(page, 'a', 900);
  await waitForBeat(page, 4, 4.1);
  await hold(page, 'g', 900);
  await waitForBeat(page, 6.5, 7);
  await page.keyboard.press('r');
  p = await project(page);
  const bass = p.notes.filter((n) => n.track === 'bass').sort((a, b) => a.start - b.start);
  expect(bass.map((n) => [n.start, n.degree])).toEqual([[0, 0], [4, 4]]);
  expect(p.phrases).toHaveLength(2);

  // multi-track sync: both layers share one transport — the pluck still lands on beat 0
  await waitForBeat(page, 0.05, 0.6);
  const held = await page.evaluate(() => (window as unknown as { __spool: { engine: () => { activeVoices: number } } }).__spool.engine().activeVoices);
  expect(held).toBeGreaterThanOrEqual(2); // pluck + bass voices sounding together at the downbeat
  await page.keyboard.press('Space'); // stop

  // --- sculpt: grab the pluck phrase on the canvas, drag outward (up in pitch) and around (later)
  await page.getByTestId('mode-sculpt').click();
  const target = pluck[1];
  const from = await notePoint(page, target, 0.5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await expect.poll(() => state<string | null>(page, 'selection')).toBe(target.phraseId);
  const step = await page.evaluate(() => {
    const w = window as unknown as { __spool: { stage: () => { layout: { band: number } }; project: () => Project } };
    const s = w.__spool.stage();
    return (s.layout.band * 0.86) / 14; // dorian: 14 steps per ring
  });
  // radial: +2 steps; angular: +1 beat (8-beat loop → 45°)
  const center = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="spool-canvas"]')!.getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
  });
  const r0 = Math.hypot(from.x - center.x, from.y - center.y);
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const r = r0 + (2 * step * i) / steps;
    const a = a0 + ((Math.PI / 4) * i) / steps;
    await page.mouse.move(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r);
  }
  await expect(page.locator('.readout')).toContainText('+2 st');
  await page.mouse.up();

  p = await project(page);
  const moved = p.notes.filter((n) => n.phraseId === target.phraseId).sort((a, b) => a.start - b.start);
  expect(moved.map((n) => n.degree)).toEqual([2, 4, 6, 9]);
  expect(moved.map((n) => n.start)).toEqual([1, 2, 3, 4]);

  // stretch ×2 via the panel, then undo/redo it
  await page.getByTestId('stretch-2').click();
  p = await project(page);
  expect(p.notes.filter((n) => n.phraseId === target.phraseId).map((n) => n.start).sort((a, b) => a - b)).toEqual([1, 3, 5, 7]);
  await page.keyboard.press('ControlOrMeta+z');
  p = await project(page);
  expect(p.notes.filter((n) => n.phraseId === target.phraseId).map((n) => n.start).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.press('ControlOrMeta+z'); // leave it un-stretched for the export check

  // --- save, reload, verify the composition survived
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByTestId('toast')).toContainText('Saved');
  const before = await project(page);
  await page.goto(E2E);
  await expect(page.getByText(`“${before.name}”`)).toBeVisible();
  await page.getByTestId('start-pointer').click();
  const after = await project(page);
  expect(after.notes).toEqual(before.notes);
  expect(after.phrases).toEqual(before.phrases);

  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/e2e-project.json', JSON.stringify(after, null, 2));

  // --- export WAV and verify the actual file
  await page.getByTestId('export-menu').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-wav').click()]);
  expect(download.suggestedFilename()).toBe('untitled-spool.wav');
  const path = await download.path();
  const bytes = readFileSync(path);
  const wav = decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const spb = 60 / after.bpm;
  const expectedSeconds = 2 * 8 * spb + 2.5;
  expect(wav.sampleRate).toBe(44100);
  expect(wav.channels).toBe(2);
  expect(wav.frames / wav.sampleRate).toBeCloseTo(expectedSeconds, 1);
  const left = wav.data[0];
  expect(rms(left)).toBeGreaterThan(0.005);

  // ffprobe agrees on the container
  const probe = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-of', 'json', path]).toString());
  expect(probe.streams[0].codec_name).toBe('pcm_s16le');
  expect(Number(probe.streams[0].sample_rate)).toBe(44100);
  expect(probe.streams[0].channels).toBe(2);
  expect(Number(probe.streams[0].duration)).toBeCloseTo(expectedSeconds, 1);

  // event timing: pluck onsets (sculpted to beats 1–4) and bass onsets (0, 4) in both loops
  const onsets = detectOnsetsFlux(left, wav.sampleRate);
  console.info('onsets', onsets.map((o) => o.toFixed(3)).join(' '));
  const expectedBeats = [0, 1, 2, 3, 4];
  for (const loop of [0, 1]) {
    for (const b of expectedBeats) {
      const t = (loop * 8 + b) * spb;
      expect(onsets.some((o) => Math.abs(o - t) < 0.035), `onset near ${t.toFixed(2)}s`).toBe(true);
    }
  }
  // …and nothing where no note begins
  const allowed = [0, 1, 2, 3, 4, 8, 9, 10, 11, 12].map((b) => b * spb);
  const stray = onsets.filter((o) => o < 16 * spb && !allowed.some((t) => Math.abs(o - t) < 0.12));
  expect(stray, `stray onsets ${stray.map((s) => s.toFixed(2))}`).toEqual([]);
  // pitch: at beat 0 only the bass sounds (D2 in D dorian)
  const bassHz = noteFrequencies(after, 'bass', 0)[0];
  const f = dominantFrequency(left, wav.sampleRate, Math.floor(0.15 * wav.sampleRate), 16384, 40, 200);
  expect(Math.abs(centsBetween(f, bassHz))).toBeLessThan(25);

  // report in the UI matches the file
  const report = await state<{ seconds: number; sampleRate: number }>(page, 'lastExport');
  expect(report.sampleRate).toBe(44100);
  expect(report.seconds).toBeCloseTo(expectedSeconds, 1);
});

test('muted thread is absent from the export', async ({ page }) => {
  await page.goto(E2E);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('open-demo').click();
  await expect(page.getByTestId('spool-canvas')).toBeVisible();
  const exportOnce = async () => {
    await page.getByTestId('export-menu').click();
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-wav').click()]);
    const b = readFileSync(await d.path());
    return decodeWav(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };
  const lowBand = (w: ReturnType<typeof decodeWav>) => {
    // energy near the bass fundamental D2 (73.4 Hz) at the downbeat
    const f = dominantFrequency(w.data[0], w.sampleRate, Math.floor(0.1 * w.sampleRate), 32768, 40, 120);
    return { f, level: rms(w.data[0], 0.1 * w.sampleRate, 0.9 * w.sampleRate) };
  };
  const full = await exportOnce();
  await page.getByTestId('mute-bass').click();
  const muted = await exportOnce();
  const a = lowBand(full);
  expect(Math.abs(centsBetween(a.f, 73.42))).toBeLessThan(30);
  // dominant low-band component disappears once bass is muted
  const fMuted = dominantFrequency(muted.data[0], muted.sampleRate, Math.floor(0.1 * muted.sampleRate), 32768, 40, 120);
  expect(Math.abs(centsBetween(fMuted, 73.42))).toBeGreaterThan(30);
  expect(rms(muted.data[0])).toBeLessThan(rms(full.data[0]));
});
