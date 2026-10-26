import { chordDegrees, degreeToMidi, midiToFrequency } from '../music/theory';
import { TRACK_IDS, type Note, type Project, type TrackId } from '../music/types';
import { VOICES } from './voices';

/**
 * The mix graph shared by live playback and export:
 *   track bus ─┬─▶ dry ─────────────┬─▶ compressor ─▶ output
 *              └─▶ reverb ─▶ wet ───┘
 */
export interface MixGraph {
  readonly buses: Record<TrackId, GainNode>;
  readonly input: GainNode;
  readonly output: AudioNode;
  applyTracks(project: Pick<Project, 'tracks'>): void;
  dispose(): void;
}

/** Deterministic PRNG so the reverb — and therefore every export — is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createImpulse(ctx: BaseAudioContext, seconds = 2.4, decay = 3.2): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const rand = mulberry32(0x5900 + ch);
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // short pre-delay, then an exponentially decaying noise tail
      const env = i < rate * 0.012 ? 0 : Math.pow(1 - t, decay);
      data[i] = (rand() * 2 - 1) * env;
    }
  }
  return buffer;
}

export function createMixGraph(ctx: BaseAudioContext, destination: AudioNode): MixGraph {
  const input = ctx.createGain();
  input.gain.value = 1;
  const dry = ctx.createGain();
  dry.gain.value = 0.86;
  const reverb = ctx.createConvolver();
  reverb.buffer = createImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.2;
  const out = ctx.createGain();
  out.gain.value = 0.92;

  input.connect(dry).connect(comp);
  input.connect(reverb).connect(wet).connect(comp);
  comp.connect(out).connect(destination);

  const buses = {} as Record<TrackId, GainNode>;
  for (const t of TRACK_IDS) {
    const bus = ctx.createGain();
    bus.connect(input);
    buses[t] = bus;
  }

  return {
    buses,
    input,
    output: out,
    applyTracks(project) {
      for (const t of TRACK_IDS) {
        const s = project.tracks[t];
        buses[t].gain.setTargetAtTime(s.muted ? 0 : s.gain, ctx.currentTime, 0.015);
      }
    },
    dispose() {
      for (const t of TRACK_IDS) buses[t].disconnect();
      for (const n of [input, dry, reverb, wet, comp, out]) n.disconnect();
    },
  };
}

/** Frequencies a note sounds at: one pitch, or a scale-third triad for chord voices. */
export function noteFrequencies(project: Pick<Project, 'root' | 'scale'>, track: TrackId, degree: number): number[] {
  const spec = VOICES[track];
  const degrees = spec.chord ? chordDegrees(degree) : [degree];
  return degrees.map((d) => midiToFrequency(degreeToMidi(d, project.root, project.scale, spec.baseMidi)));
}

export function noteMidi(project: Pick<Project, 'root' | 'scale'>, note: Pick<Note, 'track' | 'degree'>): number {
  return degreeToMidi(note.degree, project.root, project.scale, VOICES[note.track].baseMidi);
}
