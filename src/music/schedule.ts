import { loopBeats, type Note, type Project } from './types';

export interface ScheduledNote {
  readonly note: Note;
  /** Absolute beat on the transport timeline (loop iteration × loop length + note start). */
  readonly beat: number;
}

/**
 * Every note whose onset falls in [fromBeat, toBeat) on an endlessly repeating
 * loop. Pure, so the live lookahead scheduler and the offline renderer share
 * exactly the same notion of "when does this note sound".
 */
export function notesInWindow(project: Project, fromBeat: number, toBeat: number): ScheduledNote[] {
  if (toBeat <= fromBeat || project.notes.length === 0) return [];
  const length = loopBeats(project);
  const firstLoop = Math.floor(fromBeat / length);
  const lastLoop = Math.floor(toBeat / length);
  const out: ScheduledNote[] = [];
  for (let loop = firstLoop; loop <= lastLoop; loop++) {
    const base = loop * length;
    for (const note of project.notes) {
      const beat = base + note.start;
      if (beat >= fromBeat && beat < toBeat) out.push({ note, beat });
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}
