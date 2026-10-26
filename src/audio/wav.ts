/** Minimal shape of an AudioBuffer, so the encoder runs on plain arrays in tests. */
export interface PcmSource {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export const WAV_CEILING = 0.98;

/** Peak absolute sample across all channels. */
export function peakOf(source: PcmSource): number {
  let peak = 0;
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const data = source.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * Encode 16-bit PCM RIFF/WAVE. If the mix would clip, the whole file is scaled
 * down to a −0.18 dBFS ceiling rather than hard-clipping individual samples.
 */
export function encodeWav(source: PcmSource): ArrayBuffer {
  const channels = source.numberOfChannels;
  const frames = source.length;
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, source.sampleRate, true);
  view.setUint32(28, source.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  const peak = peakOf(source);
  const scale = peak > WAV_CEILING ? WAV_CEILING / peak : 1;
  const data = Array.from({ length: channels }, (_, ch) => source.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const s = Math.max(-1, Math.min(1, data[ch][i] * scale));
      view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      offset += 2;
    }
  }
  return buffer;
}

export interface DecodedWav {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly frames: number;
  readonly data: Float32Array[];
}

/** Parse a 16-bit PCM WAV (used by tests and the export self-check). */
export function decodeWav(buffer: ArrayBuffer): DecodedWav {
  const view = new DataView(buffer);
  const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file');
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (view.getUint16(body, true) !== 1) throw new Error('Not PCM');
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error('Only 16-bit PCM is supported');
      const frames = size / (channels * 2);
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let ch = 0; ch < channels; ch++) {
          data[ch][i] = view.getInt16(body + (i * channels + ch) * 2, true) / 0x8000;
        }
      }
      return { sampleRate, channels, bitsPerSample: bits, frames, data };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}
