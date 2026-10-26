import { notesInWindow } from '../music/schedule';
import { loopBeats, secondsPerBeat, type Project } from '../music/types';
import { createMixGraph, noteFrequencies } from './mix';
import { releaseTail, startVoice, VOICES } from './voices';

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

/**
 * Loops plus a tail long enough for the longest note that runs past the end
 * (plus its release) — so nothing is truncated with a click at the buffer end.
 */
export function renderDuration(project: Project, opts: RenderOptions = DEFAULT_RENDER): number {
  const loop = loopBeats(project);
  const spb = secondsPerBeat(project);
  const overhang = project.notes.reduce((m, n) => Math.max(m, n.start + n.duration - loop), 0);
  const release = project.notes.reduce((m, n) => Math.max(m, releaseTail(VOICES[n.track].adsr)), 0);
  const needed = overhang > 0 ? overhang * spb + release + 0.1 : 0;
  return opts.loops * loop * spb + Math.max(opts.tail, needed);
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
