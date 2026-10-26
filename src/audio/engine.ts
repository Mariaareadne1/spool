import { notesInWindow } from '../music/schedule';
import { mod } from '../music/theory';
import { loopBeats, secondsPerBeat, type Project, type TrackId } from '../music/types';
import { createMixGraph, noteFrequencies, type MixGraph } from './mix';
import { startVoice, type Voice } from './voices';

/** How far ahead the scheduler queues notes, and how often it wakes. */
export const LOOKAHEAD_SECONDS = 0.12;
export const TICK_MS = 25;
/** Delay between pressing play and beat 0, so the first notes are never late. */
const START_OFFSET = 0.06;

export interface LiveHandle {
  readonly id: number;
  readonly track: TrackId;
  readonly degree: number;
  /** AudioContext time the note actually started — used for recording. */
  readonly startedAt: number;
}

/**
 * Live audio: lookahead loop scheduler (the classic "two clocks" pattern — a JS
 * timer feeds Web Audio's sample-accurate clock), live performance voices and
 * an optional metronome. The project it plays is swapped atomically via
 * setProject, so edits are heard on the next scheduling tick.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private mix: MixGraph;
  private project: Project;
  private playing = false;
  private startTime = 0;
  private scheduledUntil = 0;
  private timer: number | null = null;
  private scheduled = new Set<Voice>();
  private live = new Map<number, Voice>();
  private nextHandle = 1;
  metronome = false;
  /** Count of voices currently alive (scheduled + live) — exposed for cleanup tests. */
  activeVoices = 0;

  constructor(project: Project, ctx: AudioContext = new AudioContext({ latencyHint: 'interactive' })) {
    this.ctx = ctx;
    this.project = project;
    this.mix = createMixGraph(ctx, ctx.destination);
    this.mix.applyTracks(project);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  setProject(project: Project): void {
    const prev = this.project;
    this.project = project;
    if (prev.tracks !== project.tracks) this.mix.applyTracks(project);
    if (this.playing && prev.bpm !== project.bpm) {
      // Re-anchor so the playhead keeps its musical position across a tempo change.
      const beat = (this.ctx.currentTime - this.startTime) / secondsPerBeat(prev);
      this.startTime = this.ctx.currentTime - beat * secondsPerBeat(project);
    }
    if (this.playing && (prev.bars !== project.bars)) {
      this.scheduledUntil = this.beatAt(this.ctx.currentTime);
    }
  }

  /** Absolute transport beat at an AudioContext time. */
  beatAt(time: number): number {
    return (time - this.startTime) / secondsPerBeat(this.project);
  }

  /** Current position within the loop, in beats; 0 when stopped. */
  loopPosition(): number {
    if (!this.playing) return 0;
    return mod(Math.max(0, this.beatAt(this.ctx.currentTime)), loopBeats(this.project));
  }

  loopPositionAt(time: number): number {
    return mod(Math.max(0, this.beatAt(time)), loopBeats(this.project));
  }

  async play(): Promise<void> {
    await this.resume();
    if (this.playing) return;
    this.playing = true;
    this.startTime = this.ctx.currentTime + START_OFFSET;
    this.scheduledUntil = 0;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    for (const v of this.scheduled) v.release(now);
    this.scheduled.clear();
  }

  private track(voice: Voice, set: Set<Voice> | null): void {
    this.activeVoices += 1;
    set?.add(voice);
    voice.onEnded = () => {
      this.activeVoices -= 1;
      set?.delete(voice);
    };
  }

  private tick(): void {
    if (!this.playing) return;
    const p = this.project;
    const spb = secondsPerBeat(p);
    const horizon = this.beatAt(this.ctx.currentTime + LOOKAHEAD_SECONDS);
    if (horizon <= this.scheduledUntil) return;
    const from = this.scheduledUntil;
    for (const { note, beat } of notesInWindow(p, from, horizon)) {
      if (p.tracks[note.track].muted) continue;
      const t0 = this.startTime + beat * spb;
      const voice = startVoice(this.ctx, this.mix.buses[note.track], note.track, noteFrequencies(p, note.track, note.degree), note.velocity, t0);
      voice.release(t0 + note.duration * spb);
      this.track(voice, this.scheduled);
    }
    if (this.metronome) this.scheduleClicks(from, horizon);
    this.scheduledUntil = horizon;
  }

  private scheduleClicks(from: number, to: number): void {
    const spb = secondsPerBeat(this.project);
    for (let b = Math.ceil(from); b < to; b++) {
      const t = this.startTime + b * spb;
      const accent = mod(b, this.project.beatsPerBar) === 0;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = accent ? 1760 : 1320;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(accent ? 0.09 : 0.05, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g).connect(this.mix.output);
      o.start(t);
      o.stop(t + 0.06);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    }
  }

  /** Start a performed note immediately. */
  noteOn(track: TrackId, degree: number, velocity: number): LiveHandle {
    const t0 = this.ctx.currentTime;
    const voice = startVoice(this.ctx, this.mix.buses[track], track, noteFrequencies(this.project, track, degree), velocity, t0);
    this.track(voice, null);
    const id = this.nextHandle++;
    this.live.set(id, voice);
    return { id, track, degree, startedAt: t0 };
  }

  noteOff(handle: LiveHandle): number {
    const now = this.ctx.currentTime;
    this.live.get(handle.id)?.release(now);
    this.live.delete(handle.id);
    return now;
  }

  /** Short preview of a pitch (Sculpt mode audition). */
  audition(track: TrackId, degree: number, seconds = 0.25): void {
    void this.resume();
    const t0 = this.ctx.currentTime;
    const voice = startVoice(this.ctx, this.mix.buses[track], track, noteFrequencies(this.project, track, degree), 0.6, t0);
    voice.release(t0 + seconds);
    this.track(voice, null);
  }

  releaseAllLive(): void {
    const now = this.ctx.currentTime;
    for (const v of this.live.values()) v.release(now);
    this.live.clear();
  }

  async dispose(): Promise<void> {
    this.stop();
    this.releaseAllLive();
    this.mix.dispose();
    await this.ctx.close();
  }
}
