import { mod, quantize } from './theory';
import { loopBeats, type Note, type Phrase, type Project } from './types';

/** Shortest note the instrument will keep, in beats (a 1/16 note at 4/4). */
export const MIN_DURATION = 0.25;
export const GRID = 0.25;
export const STRETCH_FACTORS = [0.5, 0.75, 1, 1.5, 2] as const;

function touch(project: Project, patch: Partial<Project>): Project {
  return { ...project, ...patch, updatedAt: Date.now() };
}

function mapPhrase(project: Project, phraseId: string, fn: (n: Note) => Note): Project {
  return touch(project, { notes: project.notes.map((n) => (n.phraseId === phraseId ? fn(n) : n)) });
}

export function findPhrase(project: Project, phraseId: string): Phrase | undefined {
  return project.phrases.find((p) => p.id === phraseId);
}

export function phraseNotes(project: Project, phraseId: string): Note[] {
  return project.notes.filter((n) => n.phraseId === phraseId);
}

/** Move every note of a phrase by `steps` scale degrees. */
export function transposePhrase(project: Project, phraseId: string, steps: number): Project {
  if (steps === 0) return project;
  return mapPhrase(project, phraseId, (n) => ({ ...n, degree: n.degree + steps }));
}

/** Rotate a phrase around the spool by `beats`; notes wrap across the loop seam. */
export function shiftPhrase(project: Project, phraseId: string, beats: number): Project {
  if (beats === 0) return project;
  const length = loopBeats(project);
  const moved = mapPhrase(project, phraseId, (n) => ({ ...n, start: mod(n.start + beats, length) }));
  return {
    ...moved,
    phrases: moved.phrases.map((p) => (p.id === phraseId ? { ...p, anchor: mod(p.anchor + beats, length) } : p)),
  };
}

/**
 * Scale a phrase in time around its anchor. Offsets are measured forward from
 * the anchor (mod loop length) so a phrase straddling the seam stays coherent.
 * Results land on the 1/16 grid; durations are clamped to [1/16, loop].
 */
export function stretchPhrase(project: Project, phraseId: string, factor: number): Project {
  if (factor === 1 || !(factor > 0)) return project;
  const phrase = findPhrase(project, phraseId);
  if (!phrase) return project;
  const length = loopBeats(project);
  return mapPhrase(project, phraseId, (n) => {
    const offset = mod(n.start - phrase.anchor, length);
    const start = mod(phrase.anchor + quantize(offset * factor, GRID), length);
    const duration = Math.min(length, Math.max(MIN_DURATION, quantize(n.duration * factor, GRID)));
    return { ...n, start, duration };
  });
}

export function deletePhrase(project: Project, phraseId: string): Project {
  return touch(project, {
    notes: project.notes.filter((n) => n.phraseId !== phraseId),
    phrases: project.phrases.filter((p) => p.id !== phraseId),
  });
}

/** Apply a combined sculpt gesture as one edit (one undo step). */
export function sculptPhrase(
  project: Project,
  phraseId: string,
  edit: { steps: number; beats: number; factor: number },
): Project {
  let next = stretchPhrase(project, phraseId, edit.factor);
  next = transposePhrase(next, phraseId, edit.steps);
  next = shiftPhrase(next, phraseId, edit.beats);
  return next;
}

/** Largest transposition in [−steps, +steps] that keeps every note of the phrase within [lo, hi]. */
export function clampSteps(project: Project, phraseId: string, steps: number, range: { lo: number; hi: number }): number {
  const degrees = phraseNotes(project, phraseId).map((n) => n.degree);
  if (degrees.length === 0) return 0;
  const min = Math.min(...degrees);
  const max = Math.max(...degrees);
  const down = Math.min(0, range.lo - min);
  const up = Math.max(0, range.hi - max);
  return Math.max(down, Math.min(up, steps));
}
