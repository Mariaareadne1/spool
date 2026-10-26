import type { TrackId } from '../music/types';

/**
 * Synth voices. Every function here takes a BaseAudioContext so the exact same
 * graph runs live (AudioContext), in the WAV exporter (OfflineAudioContext) and
 * in Node tests (node-web-audio-api). Envelopes are scheduled analytically — no
 * cancelAndHoldAtTime — so release behaves identically in every engine.
 */

export interface Adsr {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
}

export interface VoiceSpec {
  readonly label: string;
  readonly adsr: Adsr;
  /** Peak amplitude per voice at velocity 1, before the track bus. */
  readonly level: number;
  /** Track base MIDI note for degree 0 (before the key root). */
  readonly baseMidi: number;
  readonly chord: boolean;
}

export const VOICES: Record<TrackId, VoiceSpec> = {
  glass: { label: 'Glass', adsr: { attack: 0.004, decay: 1.1, sustain: 0.18, release: 0.9 }, level: 0.16, baseMidi: 72, chord: false },
  pluck: { label: 'Pluck', adsr: { attack: 0.005, decay: 0.32, sustain: 0.32, release: 0.22 }, level: 0.2, baseMidi: 60, chord: false },
  pad: { label: 'Pad', adsr: { attack: 0.28, decay: 0.6, sustain: 0.78, release: 0.8 }, level: 0.075, baseMidi: 48, chord: true },
  bass: { label: 'Bass', adsr: { attack: 0.008, decay: 0.22, sustain: 0.72, release: 0.16 }, level: 0.3, baseMidi: 36, chord: false },
};

/** Envelope value `dt` seconds after onset (before release). Exported for tests. */
export function envelopeAt(adsr: Adsr, peak: number, dt: number): number {
  if (dt <= 0) return 0;
  if (dt < adsr.attack) return (peak * dt) / adsr.attack;
  const sustain = peak * adsr.sustain;
  return sustain + (peak - sustain) * Math.exp(-(dt - adsr.attack) / (adsr.decay / 3));
}

/** Seconds after release until a voice is silent enough to stop (e^-6 ≈ −52 dB). */
export function releaseTail(adsr: Adsr): number {
  return adsr.release * 1.2;
}

export interface Voice {
  /** Schedule the release at `time`; the voice stops and disconnects itself afterwards. */
  release(time: number): void;
  /** Called once every node has stopped and been disconnected. */
  onEnded?: () => void;
}

interface VoiceParts {
  out: GainNode;
  sources: AudioScheduledSourceNode[];
  extra: AudioNode[];
}

function envelopeGain(ctx: BaseAudioContext, adsr: Adsr, peak: number, t0: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + adsr.attack);
  g.gain.setTargetAtTime(peak * adsr.sustain, t0 + adsr.attack, adsr.decay / 3);
  return g;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, detuneCents = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detuneCents;
  return o;
}

function buildPluck(ctx: BaseAudioContext, freq: number, t0: number, env: GainNode): VoiceParts {
  const a = osc(ctx, 'sawtooth', freq);
  const b = osc(ctx, 'triangle', freq, 5);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2.2;
  const bright = Math.min(14000, freq * 9);
  filter.frequency.setValueAtTime(bright, t0);
  filter.frequency.setTargetAtTime(Math.min(8000, freq * 2.2), t0 + 0.005, 0.09);
  const mixB = ctx.createGain();
  mixB.gain.value = 0.8;
  a.connect(filter);
  b.connect(mixB).connect(filter);
  filter.connect(env);
  return { out: env, sources: [a, b], extra: [filter, mixB] };
}

function buildGlass(ctx: BaseAudioContext, freq: number, t0: number, env: GainNode): VoiceParts {
  // Two-operator FM with a decaying index: bright inharmonic strike, pure sine body.
  const carrier = osc(ctx, 'sine', freq);
  const mod = osc(ctx, 'sine', freq * 3.5);
  const index = ctx.createGain();
  index.gain.setValueAtTime(freq * 2.4, t0);
  index.gain.setTargetAtTime(freq * 0.05, t0, 0.18);
  mod.connect(index).connect(carrier.frequency);
  const shimmer = osc(ctx, 'sine', freq * 2, 3);
  const shimmerGain = ctx.createGain();
  shimmerGain.gain.value = 0.12;
  carrier.connect(env);
  shimmer.connect(shimmerGain).connect(env);
  return { out: env, sources: [carrier, mod, shimmer], extra: [index, shimmerGain] };
}

function buildPad(ctx: BaseAudioContext, freqs: number[], t0: number, env: GainNode): VoiceParts {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(900, t0);
  filter.frequency.linearRampToValueAtTime(2200, t0 + 0.6);
  const sources: OscillatorNode[] = [];
  for (const f of freqs) {
    for (const cents of [-7, 7]) {
      const o = osc(ctx, 'sawtooth', f, cents);
      o.connect(filter);
      sources.push(o);
    }
  }
  filter.connect(env);
  return { out: env, sources, extra: [filter] };
}

function buildBass(ctx: BaseAudioContext, freq: number, t0: number, env: GainNode): VoiceParts {
  const body = osc(ctx, 'sine', freq);
  const edge = osc(ctx, 'triangle', freq * 2);
  const edgeGain = ctx.createGain();
  edgeGain.gain.setValueAtTime(0.35, t0);
  edgeGain.gain.setTargetAtTime(0.12, t0, 0.08);
  body.connect(env);
  edge.connect(edgeGain).connect(env);
  return { out: env, sources: [body, edge], extra: [edgeGain] };
}

/**
 * Start a voice at `t0`. `freqs` is one frequency, or three for a chord voice.
 * Connects to `destination`; disconnects itself when finished.
 */
export function startVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  track: TrackId,
  freqs: number[],
  velocity: number,
  t0: number,
): Voice {
  const spec = VOICES[track];
  const peak = spec.level * (0.35 + 0.65 * Math.max(0, Math.min(1, velocity)));
  const env = envelopeGain(ctx, spec.adsr, peak, t0);
  const parts =
    track === 'pluck' ? buildPluck(ctx, freqs[0], t0, env)
    : track === 'glass' ? buildGlass(ctx, freqs[0], t0, env)
    : track === 'pad' ? buildPad(ctx, freqs, t0, env)
    : buildBass(ctx, freqs[0], t0, env);
  parts.out.connect(destination);
  for (const s of parts.sources) s.start(t0);

  let released = false;
  let remaining = parts.sources.length;
  const voice: Voice = {
    release(time: number) {
      if (released) return;
      released = true;
      const tr = Math.max(time, t0);
      const value = envelopeAt(spec.adsr, peak, tr - t0);
      const g = env.gain;
      g.cancelScheduledValues(tr);
      g.setValueAtTime(value, tr);
      g.setTargetAtTime(0, tr, spec.adsr.release / 5);
      const end = tr + releaseTail(spec.adsr);
      g.setValueAtTime(0, end);
      for (const s of parts.sources) s.stop(end + 0.01);
    },
  };
  const finish = () => {
    remaining -= 1;
    if (remaining > 0) return;
    for (const s of parts.sources) s.disconnect();
    for (const n of parts.extra) n.disconnect();
    parts.out.disconnect();
    voice.onEnded?.();
  };
  for (const s of parts.sources) s.onended = finish;
  return voice;
}
