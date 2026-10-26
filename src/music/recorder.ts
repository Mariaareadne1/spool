import { makeId, nextOrdinal } from './project';
import { mod, quantize } from './theory';
import { GRID, MIN_DURATION } from './transform';
import { loopBeats, type Note, type Phrase, type Project, type TrackId } from './types';

export interface Take {
  readonly phrase: Phrase;
  readonly notes: readonly Note[];
}

interface Held {
  readonly degree: number;
  readonly velocity: number;
  /** Absolute transport beat at note-on. */
  readonly beat: number;
}

/**
 * Turns performed note-on/note-off pairs into a phrase. Times are absolute
 * transport beats (they keep counting across loop passes), so a note held
 * over the loop seam keeps its true length. Pure state in, new state out.
 */
export class Recorder {
  private held = new Map<number, Held>();
  private take: Take;
  private readonly length: number;
  /** Absolute beat of the earliest onset so far — the phrase anchor. */
  private anchorBeat = Infinity;

  constructor(project: Project, track: TrackId, readonly snap: boolean) {
    this.length = loopBeats(project);
    this.take = {
      phrase: { id: makeId('phr'), track, ordinal: nextOrdinal(project, track), anchor: 0 },
      notes: [],
    };
  }

  get current(): Take {
    return this.take;
  }

  get track(): TrackId {
    return this.take.phrase.track;
  }

  noteOn(handle: number, degree: number, velocity: number, beat: number): void {
    this.held.set(handle, { degree, velocity, beat });
  }

  /** Returns the finished note (also appended to the take), or null if the handle was unknown. */
  noteOff(handle: number, beat: number): Note | null {
    const h = this.held.get(handle);
    if (!h) return null;
    this.held.delete(handle);
    return this.append(h, beat);
  }

  /** Forget a held note without recording it (it was retuned before it meant anything). */
  cancel(handle: number): void {
    this.held.delete(handle);
  }

  /** Close every held note at `beat` (recording stopped while fingers were still down). */
  flush(beat: number): void {
    for (const [handle] of this.held) this.noteOff(handle, beat);
  }

  private append(h: Held, endBeat: number): Note {
    const rawStart = this.snap ? quantize(h.beat, GRID) : h.beat;
    const start = mod(rawStart, this.length);
    let duration = Math.max(MIN_DURATION, endBeat - h.beat);
    if (this.snap) duration = Math.max(MIN_DURATION, quantize(duration, GRID));
    duration = Math.min(this.length, duration);
    const note: Note = {
      id: makeId('n'),
      phraseId: this.take.phrase.id,
      track: this.take.phrase.track,
      start: start >= this.length ? 0 : start,
      duration,
      degree: h.degree,
      velocity: h.velocity,
    };
    const earliest = h.beat < this.anchorBeat;
    if (earliest) this.anchorBeat = h.beat;
    this.take = {
      phrase: earliest ? { ...this.take.phrase, anchor: note.start } : this.take.phrase,
      notes: [...this.take.notes, note],
    };
    return note;
  }
}
