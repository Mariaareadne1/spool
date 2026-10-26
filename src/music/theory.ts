/**
 * Pitch is stored as a scale degree, not a MIDI number. A phrase that is
 * transposed or re-keyed therefore stays inside the scale — the instrument
 * can never play a wrong note, which matters when the input is a hand in the air.
 */

export const SCALES = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
} as const;

export type ScaleName = keyof typeof SCALES;

export const SCALE_LABELS: Record<ScaleName, string> = {
  majorPentatonic: 'major pentatonic',
  minorPentatonic: 'minor pentatonic',
  dorian: 'dorian',
  major: 'major',
  minor: 'natural minor',
};

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function isScaleName(value: unknown): value is ScaleName {
  return typeof value === 'string' && Object.hasOwn(SCALES, value);
}

/** Scale degree (0 = tonic of the base octave, may be negative) → MIDI note number. */
export function degreeToMidi(degree: number, root: number, scale: ScaleName, baseMidi: number): number {
  const steps = SCALES[scale];
  const octave = Math.floor(degree / steps.length);
  const index = mod(degree, steps.length);
  return baseMidi + root + 12 * octave + steps[index];
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi: number): string {
  return `${NOTE_NAMES[mod(midi, 12)]}${Math.floor(midi / 12) - 1}`;
}

/** Degrees of a chord stacked in scale-thirds on `degree` (root, third, fifth in scale steps). */
export function chordDegrees(degree: number): number[] {
  return [degree, degree + 2, degree + 4];
}

export function quantize(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}
