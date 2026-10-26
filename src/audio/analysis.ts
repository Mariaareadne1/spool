/**
 * Signal analysis used to verify that rendered audio matches the composition:
 * pitch (FFT peak with parabolic interpolation), loudness envelopes and onsets.
 * Pure functions over Float32Array, shared by unit tests and the E2E export check.
 */

export function rms(data: Float32Array, start = 0, end = data.length): number {
  const s = Math.max(0, Math.floor(start));
  const e = Math.min(data.length, Math.floor(end));
  if (e <= s) return 0;
  let sum = 0;
  for (let i = s; i < e; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (e - s));
}

export function peak(data: Float32Array): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) p = Math.max(p, Math.abs(data[i]));
  return p;
}

function fftMagnitudes(input: Float32Array): Float64Array {
  const n = input.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // Hann window
  for (let i = 0; i < n; i++) re[i] = input[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const mags = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i], im[i]);
  return mags;
}

/** Magnitude spectrum of a power-of-two window starting at `start`. */
export function spectrum(data: Float32Array, sampleRate: number, start: number, size = 16384): { mags: Float64Array; binHz: number } {
  const slice = new Float32Array(size);
  slice.set(data.subarray(start, Math.min(data.length, start + size)));
  return { mags: fftMagnitudes(slice), binHz: sampleRate / size };
}

/** Frequency of the strongest spectral peak in [minHz, maxHz]. */
export function dominantFrequency(data: Float32Array, sampleRate: number, start: number, size = 16384, minHz = 40, maxHz = 5000): number {
  const { mags, binHz } = spectrum(data, sampleRate, start, size);
  const lo = Math.max(1, Math.floor(minHz / binHz));
  const hi = Math.min(mags.length - 2, Math.ceil(maxHz / binHz));
  let best = lo;
  for (let i = lo; i <= hi; i++) if (mags[i] > mags[best]) best = i;
  const a = mags[best - 1];
  const b = mags[best];
  const c = mags[best + 1];
  const denom = a - 2 * b + c;
  const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  return (best + shift) * binHz;
}

/** Relative energy at `hz` (± a few bins) vs the spectrum's maximum — "is this pitch present?". */
export function energyAt(data: Float32Array, sampleRate: number, start: number, hz: number, size = 16384): number {
  const { mags, binHz } = spectrum(data, sampleRate, start, size);
  const centre = Math.round(hz / binHz);
  let local = 0;
  for (let i = centre - 2; i <= centre + 2; i++) if (i > 0 && i < mags.length) local = Math.max(local, mags[i]);
  let max = 0;
  for (let i = 1; i < mags.length; i++) max = Math.max(max, mags[i]);
  return max === 0 ? 0 : local / max;
}

/**
 * Times (s) where short-window energy jumps well above the loudest of the
 * preceding ~60 ms — note onsets. Comparing against the recent maximum (not
 * the mean) keeps decaying tails and beating partials from re-triggering.
 */
export function detectOnsets(data: Float32Array, sampleRate: number, hop = 256, ratio = 3, floor = 0.004): number[] {
  const frames = Math.floor(data.length / hop);
  const energies = new Float64Array(frames);
  for (let f = 0; f < frames; f++) energies[f] = rms(data, f * hop, (f + 1) * hop);
  const lookback = Math.max(2, Math.round((0.06 * sampleRate) / hop));
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let f = 0; f < frames; f++) {
    let recent = floor;
    for (let k = Math.max(0, f - lookback); k < f - 1; k++) recent = Math.max(recent, energies[k]);
    const t = (f * hop) / sampleRate;
    if (energies[f] > recent * ratio && t - lastOnset > 0.1) {
      onsets.push(t);
      lastOnset = t;
    }
  }
  return onsets;
}

/**
 * Spectral-flux onsets: the summed *increase* in magnitude across all bins
 * between successive frames. A new note adds energy in new bins even while
 * another note sustains, so masked attacks still register (energy ratios miss
 * a pluck over a held bass). Peaks above an adaptive median threshold count.
 */
export function detectOnsetsFlux(input: Float32Array, sampleRate: number, size = 1024, hop = 256, sensitivity = 1.6): number[] {
  // lead-in silence so an attack at t = 0 still has a "before" frame
  const data = new Float32Array(input.length + size);
  data.set(input, size);
  const frames = Math.floor((data.length - size) / hop);
  if (frames < 3) return [];
  const flux = new Float64Array(frames);
  let prev: Float64Array | null = null;
  const slice = new Float32Array(size);
  for (let f = 0; f < frames; f++) {
    slice.set(data.subarray(f * hop, f * hop + size));
    const mags = fftMagnitudes(slice);
    if (prev) {
      let sum = 0;
      for (let i = 1; i < mags.length; i++) {
        // sqrt compression: between linear (loud-biased) and log (noise-biased)
        const d = Math.sqrt(mags[i]) - Math.sqrt(prev[i]);
        if (d > 0) sum += d;
      }
      flux[f] = sum;
    }
    prev = mags;
  }
  const win = Math.round((0.25 * sampleRate) / hop);
  let max = 0;
  for (let f = 0; f < frames; f++) max = Math.max(max, flux[f]);
  const onsets: number[] = [];
  let last = -Infinity;
  for (let f = 1; f < frames - 1; f++) {
    const lo = Math.max(0, f - win);
    const hi = Math.min(frames, f + win);
    const local = Array.from(flux.subarray(lo, hi)).sort((a, b) => a - b);
    const median = local[Math.floor(local.length / 2)];
    const threshold = Math.max(median * sensitivity, max * 0.12);
    const isPeak = flux[f] > flux[f - 1] && flux[f] >= flux[f + 1];
    // frame f compares windows starting at (f-1)·hop and f·hop: the attack sits ~half a window in
    const t = (f * hop + size / 2 - size) / sampleRate;
    if (isPeak && flux[f] > threshold && t - last > 0.08 && t >= -0.01) {
      onsets.push(Math.max(0, t));
      last = t;
    }
  }
  return onsets;
}

export function centsBetween(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}
