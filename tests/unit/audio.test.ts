import { describe, expect, test } from 'vitest';
import { OfflineAudioContext as NodeOffline } from 'node-web-audio-api';
import { renderProject, renderDuration, type RenderOptions } from '../../src/audio/render';
import { decodeWav, encodeWav } from '../../src/audio/wav';
import { centsBetween, detectOnsets, dominantFrequency, energyAt, peak, rms } from '../../src/audio/analysis';
import { envelopeAt, startVoice, VOICES } from '../../src/audio/voices';
import { noteFrequencies } from '../../src/audio/mix';
import { addPhrase, createProject, setTrack } from '../../src/music/project';
import { transposePhrase, shiftPhrase } from '../../src/music/transform';
import { degreeToMidi, midiToFrequency } from '../../src/music/theory';
import type { Note, Project, TrackId } from '../../src/music/types';

const Offline = NodeOffline as unknown as new (c: number, l: number, r: number) => OfflineAudioContext;
const SR = 44100;
const ONE_LOOP: RenderOptions = { loops: 1, tail: 1, sampleRate: SR, channels: 2 };

function compose(notes: Array<Partial<Note> & { start: number; degree: number }>, track: TrackId = 'pluck', base?: Project): Project {
  const p = base ?? createProject({ bpm: 120, bars: 1, root: 0, scale: 'major' });
  const phraseId = `ph_${track}_${notes.length}_${notes[0]?.start ?? 0}`;
  return addPhrase(
    p,
    { id: phraseId, track, ordinal: 1, anchor: notes[0]?.start ?? 0 },
    notes.map((n, i) => ({ id: `${phraseId}_${i}`, phraseId, track, duration: 0.5, velocity: 0.9, ...n })),
  );
}

describe('voices', () => {
  test('pluck sounds at the scale pitch (C4 major degree 0 = 261.63 Hz, degree 4 = G4)', async () => {
    const p = compose([{ start: 0, degree: 0, duration: 1.5 }, { start: 2, degree: 4, duration: 1.5 }]);
    const buf = await renderProject(p, ONE_LOOP, Offline);
    const ch = buf.getChannelData(0);
    const c4 = dominantFrequency(ch, SR, Math.floor(0.15 * SR), 16384, 100, 1000);
    const g4 = dominantFrequency(ch, SR, Math.floor(1.15 * SR), 16384, 100, 1000);
    expect(Math.abs(centsBetween(c4, 261.6256))).toBeLessThan(15);
    expect(Math.abs(centsBetween(g4, 391.9954))).toBeLessThan(15);
  });

  test('each track voice is in its register', async () => {
    const cases: Array<[TrackId, number]> = [['bass', 36], ['glass', 72]];
    for (const [track, midi] of cases) {
      const p = compose([{ start: 0, degree: 0, duration: 2 }], track);
      const buf = await renderProject(p, ONE_LOOP, Offline);
      const f = dominantFrequency(buf.getChannelData(0), SR, Math.floor(0.3 * SR), 32768, 30, 2000);
      expect(Math.abs(centsBetween(f, midiToFrequency(midi)))).toBeLessThan(20);
    }
  });

  test('pad plays a scale-third triad (C E G for degree 0 in C major)', async () => {
    const p = compose([{ start: 0, degree: 0, duration: 3 }], 'pad');
    expect(noteFrequencies(p, 'pad', 0).map((f) => Math.round(f))).toEqual([131, 165, 196]);
    const buf = await renderProject(p, ONE_LOOP, Offline);
    const ch = buf.getChannelData(0);
    const at = Math.floor(0.8 * SR);
    for (const hz of [130.81, 164.81, 196]) expect(energyAt(ch, SR, at, hz, 32768)).toBeGreaterThan(0.25);
    // C♯ (not in the chord) should be much weaker
    expect(energyAt(ch, SR, at, 138.59, 32768)).toBeLessThan(0.15);
  });

  test('ADSR: attack rises, sustains, and releases to silence', async () => {
    const ctx = new Offline(1, SR * 2, SR);
    const v = startVoice(ctx, ctx.destination, 'bass', [110], 1, 0.1);
    v.release(1.0);
    let ended = false;
    v.onEnded = () => { ended = true; };
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    const win = (t: number) => rms(d, t * SR, (t + 0.02) * SR);
    expect(win(0.05)).toBeLessThan(1e-4); // before onset
    expect(win(0.5)).toBeGreaterThan(0.05); // sustaining
    const spec = VOICES.bass;
    // sustain level matches the analytic envelope within 25%
    const expectedSustain = envelopeAt(spec.adsr, spec.level, 0.4) / Math.SQRT2;
    expect(win(0.5)).toBeGreaterThan(expectedSustain * 0.5);
    expect(win(1.0 + spec.adsr.release * 1.3)).toBeLessThan(win(0.5) * 0.02); // released
    expect(ended).toBe(true); // nodes stopped and disconnected
  });
});

describe('offline render = the composition', () => {
  test('onsets land where the notes are (120 bpm → 0.5 s per beat)', async () => {
    const p = compose([0, 1, 2, 3].map((b) => ({ start: b, degree: b, duration: 0.25 })));
    const buf = await renderProject(p, { ...ONE_LOOP, loops: 2 }, Offline);
    const onsets = detectOnsets(buf.getChannelData(0), SR);
    const expected = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    expect(onsets.length).toBe(expected.length);
    onsets.forEach((t, i) => expect(Math.abs(t - expected[i])).toBeLessThan(0.02));
  });

  test('duration follows tempo and loop count', async () => {
    const p = compose([{ start: 0, degree: 0 }]);
    const buf = await renderProject(p, { ...ONE_LOOP, loops: 3, tail: 0.5 }, Offline);
    expect(buf.duration).toBeCloseTo(3 * 4 * 0.5 + 0.5, 2);
    expect(renderDuration({ ...p, bpm: 60 }, { ...ONE_LOOP, loops: 1, tail: 0 })).toBe(4);
  });

  test('muted tracks are silent; unmuted are not', async () => {
    const p = compose([{ start: 0, degree: 0, duration: 1 }]);
    const muted = await renderProject(setTrack(p, 'pluck', { muted: true }), ONE_LOOP, Offline);
    const live = await renderProject(p, ONE_LOOP, Offline);
    expect(peak(muted.getChannelData(0))).toBeLessThan(1e-5);
    expect(peak(live.getChannelData(0))).toBeGreaterThan(0.05);
  });

  test('transpose and shift change the actual audio', async () => {
    const p = compose([{ start: 0, degree: 0, duration: 1.5 }]);
    const phraseId = p.phrases[0].id;
    const up = transposePhrase(p, phraseId, 2); // C → E
    const buf = await renderProject(up, ONE_LOOP, Offline);
    const f = dominantFrequency(buf.getChannelData(0), SR, Math.floor(0.15 * SR), 16384, 100, 1000);
    expect(Math.abs(centsBetween(f, midiToFrequency(degreeToMidi(2, 0, 'major', 60))))).toBeLessThan(15);

    const late = shiftPhrase(p, phraseId, 2); // one second later
    const lb = await renderProject(late, ONE_LOOP, Offline);
    const onsets = detectOnsets(lb.getChannelData(0), SR);
    expect(Math.abs(onsets[0] - 1)).toBeLessThan(0.02);
  });

  test('render is deterministic', async () => {
    const p = compose([{ start: 0, degree: 0 }, { start: 1, degree: 3 }]);
    const a = await renderProject(p, ONE_LOOP, Offline);
    const b = await renderProject(p, ONE_LOOP, Offline);
    expect(Array.from(a.getChannelData(1).subarray(10000, 10100))).toEqual(Array.from(b.getChannelData(1).subarray(10000, 10100)));
  });
});

describe('wav', () => {
  test('encodes a valid 16-bit stereo file that decodes back', async () => {
    const p = compose([{ start: 0, degree: 0, duration: 1 }]);
    const buf = await renderProject(p, ONE_LOOP, Offline);
    const wav = encodeWav(buf);
    expect(wav.byteLength).toBe(44 + buf.length * 2 * 2);
    const dec = decodeWav(wav);
    expect(dec.sampleRate).toBe(SR);
    expect(dec.channels).toBe(2);
    expect(dec.bitsPerSample).toBe(16);
    expect(dec.frames).toBe(buf.length);
    const i = Math.floor(0.2 * SR);
    expect(Math.abs(dec.data[0][i] - buf.getChannelData(0)[i])).toBeLessThan(1 / 16384);
  });

  test('scales instead of clipping when the mix is too hot', () => {
    const data = new Float32Array([0, 1.5, -3, 0.75]);
    const wav = encodeWav({ numberOfChannels: 1, sampleRate: 8000, length: 4, getChannelData: () => data });
    const dec = decodeWav(wav);
    expect(Math.max(...Array.from(dec.data[0]).map(Math.abs))).toBeCloseTo(0.98, 3);
    expect(dec.data[0][1]).toBeCloseTo(0.49, 2); // relative levels preserved
  });
});

describe('spectral flux onsets', async () => {
  const { detectOnsetsFlux } = await import('../../src/audio/analysis');
  test('finds a pluck attack masked by a sustained bass note', async () => {
    let p = compose([{ start: 0, degree: 0, duration: 4 }], 'bass');
    p = compose([{ start: 1, degree: 4, duration: 0.5 }, { start: 2.5, degree: 2, duration: 0.5 }], 'pluck', p);
    const buf = await renderProject(p, ONE_LOOP, Offline);
    const onsets = detectOnsetsFlux(buf.getChannelData(0), SR);
    for (const t of [0, 0.5, 1.25]) expect(onsets.some((o) => Math.abs(o - t) < 0.03)).toBe(true);
    expect(onsets.length).toBeLessThanOrEqual(4);
  });
});

describe('early release (transport stop)', () => {
  test('a voice already scheduled to release later can be released earlier', async () => {
    const ctx = new Offline(1, SR * 3, SR);
    const v = startVoice(ctx, ctx.destination, 'pad', [220, 277, 330], 1, 0);
    v.release(2.5); // what the scheduler does when it queues a long note
    v.release(0.5, true); // transport stop
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    expect(rms(d, 0.3 * SR, 0.45 * SR)).toBeGreaterThan(0.01);
    expect(rms(d, 0.8 * SR, 1.0 * SR)).toBeLessThan(1e-4);
  });
  test('a voice scheduled in the future never sounds if stopped before it starts', async () => {
    const ctx = new Offline(1, SR * 2, SR);
    const v = startVoice(ctx, ctx.destination, 'pluck', [440], 1, 1.0);
    v.release(1.5);
    v.release(0.2, true);
    const buf = await ctx.startRendering();
    expect(peak(buf.getChannelData(0))).toBeLessThan(1e-5);
  });
});

describe('render length', () => {
  test('tail grows to fit a note that runs past the last loop', () => {
    const p = compose([{ start: 3.5, degree: 0, duration: 4 }], 'pad'); // 120 bpm, 4-beat loop
    const d = renderDuration(p, { loops: 1, tail: 0.5, sampleRate: SR, channels: 2 });
    // note ends 3.5 beats past the loop (1.75 s) + pad release tail 0.96 s
    expect(d).toBeGreaterThanOrEqual(2 + 1.75 + 0.96);
  });
});
