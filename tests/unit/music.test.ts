import { describe, expect, test } from 'vitest';
import { chordDegrees, degreeToMidi, midiToFrequency, midiToName, quantize } from '../../src/music/theory';
import { addPhrase, createProject, parseProject, ProjectFormatError, updateSettings } from '../../src/music/project';
import { notesInWindow } from '../../src/music/schedule';
import { deletePhrase, sculptPhrase, shiftPhrase, stretchPhrase, transposePhrase } from '../../src/music/transform';
import { canRedo, canUndo, commit, createHistory, redo, undo } from '../../src/music/history';
import type { Note, Phrase, Project } from '../../src/music/types';

function withPhrase(p: Project, starts: number[], opts: Partial<Note> = {}, anchor = starts[0]): Project {
  const phrase: Phrase = { id: 'ph1', track: 'pluck', ordinal: 1, anchor };
  const notes: Note[] = starts.map((s, i) => ({
    id: `n${i}`, phraseId: 'ph1', track: 'pluck', start: s, duration: 0.5, degree: i, velocity: 0.8, ...opts,
  }));
  return addPhrase(p, phrase, notes);
}

describe('theory', () => {
  test('A4 is 440 Hz and octaves double', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(81)).toBeCloseTo(880, 6);
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
  });

  test('degrees map into the scale and wrap octaves', () => {
    // D dorian from C4 base: D E F G A B C
    const d = (deg: number) => midiToName(degreeToMidi(deg, 2, 'dorian', 60));
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(d)).toEqual(['D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5']);
    expect(d(-1)).toBe('C4');
    expect(degreeToMidi(5, 0, 'majorPentatonic', 60)).toBe(72);
  });

  test('chords stack scale thirds: degree 0 in C major is a C major triad', () => {
    const midis = chordDegrees(0).map((g) => degreeToMidi(g, 0, 'major', 60));
    expect(midis).toEqual([60, 64, 67]);
    const ii = chordDegrees(1).map((g) => degreeToMidi(g, 0, 'major', 60));
    expect(ii).toEqual([62, 65, 69]); // D minor: minor third + major third
  });

  test('quantize rounds to grid', () => {
    expect(quantize(1.13, 0.25)).toBe(1.25);
    expect(quantize(1.1, 0.25)).toBe(1);
  });
});

describe('transforms are immutable and musically correct', () => {
  const base = withPhrase(createProject({ bars: 2 }), [0, 1, 2]);

  test('transpose moves degrees and leaves original untouched', () => {
    const t = transposePhrase(base, 'ph1', 3);
    expect(t.notes.map((n) => n.degree)).toEqual([3, 4, 5]);
    expect(base.notes.map((n) => n.degree)).toEqual([0, 1, 2]);
  });

  test('shift wraps around the loop seam and moves the anchor', () => {
    const s = shiftPhrase(base, 'ph1', 7);
    expect(s.notes.map((n) => n.start)).toEqual([7, 0, 1]);
    expect(s.phrases[0].anchor).toBe(7);
  });

  test('stretch scales offsets from the anchor, even across the seam', () => {
    const wrapped = withPhrase(createProject({ bars: 2 }), [7, 7.5, 0.5], {}, 7); // loop = 8 beats
    const s = stretchPhrase(wrapped, 'ph1', 2);
    expect(s.notes.map((n) => n.start)).toEqual([7, 0, 2]);
    expect(s.notes.every((n) => n.duration === 1)).toBe(true);
    const h = stretchPhrase(base, 'ph1', 0.5);
    expect(h.notes.map((n) => n.start)).toEqual([0, 0.5, 1]);
    expect(h.notes.every((n) => n.duration === 0.25)).toBe(true);
  });

  test('sculpt combines stretch, transpose and shift; delete removes the phrase', () => {
    const s = sculptPhrase(base, 'ph1', { steps: -2, beats: 1, factor: 2 });
    expect(s.notes.map((n) => [n.start, n.degree])).toEqual([[1, -2], [3, -1], [5, 0]]);
    const d = deletePhrase(s, 'ph1');
    expect(d.notes).toHaveLength(0);
    expect(d.phrases).toHaveLength(0);
  });

  test('no-op edits return the same object', () => {
    expect(transposePhrase(base, 'ph1', 0)).toBe(base);
    expect(stretchPhrase(base, 'ph1', 1)).toBe(base);
  });
});

describe('scheduler window', () => {
  const p = withPhrase(createProject({ bars: 1 }), [0, 2]); // loop = 4 beats
  test('returns notes across loop iterations in order', () => {
    const w = notesInWindow(p, 3, 10);
    expect(w.map((s) => s.beat)).toEqual([4, 6, 8]);
  });
  test('half-open window never double-schedules at a boundary', () => {
    const a = notesInWindow(p, 0, 2).map((s) => s.beat);
    const b = notesInWindow(p, 2, 4).map((s) => s.beat);
    expect(a).toEqual([0]);
    expect(b).toEqual([2]);
  });
});

describe('project validation', () => {
  test('round-trips through JSON', () => {
    const p = withPhrase(createProject(), [0, 1.5]);
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  test('rejects corrupt data with a clear error', () => {
    expect(() => parseProject(null)).toThrow(ProjectFormatError);
    expect(() => parseProject({ ...createProject(), bpm: 999 })).toThrow(/Tempo/);
    const p = withPhrase(createProject(), [0]);
    expect(() => parseProject({ ...p, phrases: [] })).toThrow(/missing phrase/);
  });
  test('tempo is clamped', () => {
    expect(updateSettings(createProject(), { bpm: 400 }).bpm).toBe(160);
  });
});

describe('history', () => {
  test('undo and redo walk the stack', () => {
    let h = createHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = commit(h, 9);
    expect(canRedo(h)).toBe(false);
  });
});
