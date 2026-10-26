import type { ScaleName } from './theory';

export const TRACK_IDS = ['glass', 'pluck', 'pad', 'bass'] as const;
export type TrackId = (typeof TRACK_IDS)[number];

/** One sounding event. Times are in beats, measured from the top of the loop. */
export interface Note {
  readonly id: string;
  readonly phraseId: string;
  readonly track: TrackId;
  readonly start: number;
  readonly duration: number;
  readonly degree: number;
  readonly velocity: number;
}

/**
 * A phrase is everything captured in one recording pass. It is the unit that
 * Sculpt mode grabs. `anchor` is where the phrase begins in the loop — stretch
 * scales note offsets measured from it, so phrases that wrap past the loop
 * seam still stretch correctly.
 */
export interface Phrase {
  readonly id: string;
  readonly track: TrackId;
  readonly ordinal: number;
  readonly anchor: number;
}

export interface TrackState {
  readonly muted: boolean;
  readonly gain: number;
}

export interface Project {
  readonly schema: 1;
  readonly id: string;
  readonly name: string;
  readonly bpm: number;
  readonly bars: number;
  readonly beatsPerBar: number;
  readonly root: number;
  readonly scale: ScaleName;
  readonly tracks: Readonly<Record<TrackId, TrackState>>;
  readonly notes: readonly Note[];
  readonly phrases: readonly Phrase[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function loopBeats(project: Pick<Project, 'bars' | 'beatsPerBar'>): number {
  return project.bars * project.beatsPerBar;
}

export function secondsPerBeat(project: Pick<Project, 'bpm'>): number {
  return 60 / project.bpm;
}
