import { addPhrase, createProject, makeId } from './project';
import type { Note, Project, TrackId } from './types';

type Spec = [start: number, duration: number, degree: number, velocity?: number];

function phrase(project: Project, track: TrackId, specs: Spec[]): Project {
  const id = makeId('phr');
  const ordinal = project.phrases.filter((p) => p.track === track).length + 1;
  const notes: Note[] = specs.map(([start, duration, degree, velocity = 0.8]) => ({
    id: makeId('n'), phraseId: id, track, start, duration, degree, velocity,
  }));
  return addPhrase(project, { id, track, ordinal, anchor: specs[0][0] }, notes);
}

/**
 * "First Light" — a two-bar loop in D dorian, composed in SPOOL's own data
 * model. It is a real, playable project: the landing page renders it with the
 * same renderer as the instrument, and it can be opened and edited.
 */
export function demoProject(): Project {
  let p = createProject({ name: 'First Light', bpm: 92, bars: 2, root: 2, scale: 'dorian' });
  p = phrase(p, 'bass', [[0, 1.5, 0, 0.9], [1.5, 0.5, 0, 0.6], [2, 1, 4, 0.8], [3.5, 0.5, 3, 0.6], [4, 1.5, 5, 0.9], [5.5, 0.5, 5, 0.6], [6, 1.25, 3, 0.8], [7.5, 0.5, 4, 0.6]]);
  p = phrase(p, 'pad', [[0, 3.75, 0, 0.6], [4, 3.75, 5, 0.6]]);
  p = phrase(p, 'pluck', [[0, 0.5, 7, 0.9], [0.75, 0.25, 9, 0.7], [1, 0.75, 8, 0.8], [2, 0.5, 11, 0.85], [2.5, 0.5, 9, 0.7], [3, 1, 7, 0.75], [4.5, 0.5, 6, 0.8], [5, 0.25, 7, 0.7], [5.25, 0.25, 9, 0.7], [5.5, 1.5, 10, 0.9], [7.25, 0.5, 8, 0.6]]);
  p = phrase(p, 'glass', [[0.5, 0.75, 11, 0.6], [2.75, 0.75, 14, 0.5], [4.75, 0.75, 12, 0.6], [6.5, 1, 9, 0.5]]);
  return p;
}
