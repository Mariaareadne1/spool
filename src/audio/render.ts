import { notesInWindow } from '../music/schedule';
import { loopBeats, secondsPerBeat, type Project } from '../music/types';
import { createMixGraph, noteFrequencies } from './mix';
import { startVoice } from './voices';

export interface RenderOptions {
  /** How many times the loop plays. */
  readonly loops: number;
  /** Seconds of reverb/release tail after the last loop. */
  readonly tail: number;
  readonly sampleRate: number;
  readonly channels: number;
}

export const DEFAULT_RENDER: RenderOptions = { loops: 2, tail: 2.5, sampleRate: 44100, channels: 2 };

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export function renderDuration(project: Project, opts: RenderOptions = DEFAULT_RENDER): number {
  return opts.loops * loopBeats(project) * secondsPerBeat(project) + opts.tail;
}

/**
 * Render the composition offline through the same voices and mix graph that
 * play live. Muted tracks are skipped entirely (not just silenced).
 */
export async function renderProject(
  project: Project,
  opts: RenderOptions = DEFAULT_RENDER,
  Offline: OfflineCtor = OfflineAudioContext,
): Promise<AudioBuffer> {
  const seconds = renderDuration(project, opts);
  const ctx = new Offline(opts.channels, Math.ceil(seconds * opts.sampleRate), opts.sampleRate);
  const mix = createMixGraph(ctx, ctx.destination);
  mix.applyTracks(project);
  const spb = secondsPerBeat(project);
  const events = notesInWindow(project, 0, opts.loops * loopBeats(project));
  for (const { note, beat } of events) {
    if (project.tracks[note.track].muted) continue;
    const t0 = beat * spb;
    const voice = startVoice(ctx, mix.buses[note.track], note.track, noteFrequencies(project, note.track, note.degree), note.velocity, t0);
    voice.release(t0 + note.duration * spb);
  }
  return ctx.startRendering();
}
