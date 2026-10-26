import { peak as peakOf, rms } from '../audio/analysis';
import { DEFAULT_RENDER, renderProject, type RenderOptions } from '../audio/render';
import { decodeWav, encodeWav } from '../audio/wav';
import { parseProject } from '../music/project';
import type { Project } from '../music/types';

export interface ExportReport {
  readonly fileName: string;
  readonly bytes: number;
  readonly seconds: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly peakDb: number;
  readonly rmsDb: number;
}

const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

export function safeFileName(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'spool';
}

/**
 * Render → encode → decode the encoded bytes back and check them. The report
 * describes the file that was actually written, not the intention.
 */
export async function renderWav(project: Project, opts: RenderOptions = DEFAULT_RENDER): Promise<{ blob: Blob; report: ExportReport }> {
  if (project.notes.length === 0) throw new Error('Nothing to export yet — record a phrase first.');
  const buffer = await renderProject(project, opts);
  const wav = encodeWav(buffer);
  const check = decodeWav(wav);
  const left = check.data[0];
  const p = Math.max(...check.data.map(peakOf));
  if (p < 1e-4) throw new Error('The render came back silent — are all tracks muted?');
  const report: ExportReport = {
    fileName: `${safeFileName(project.name)}.wav`,
    bytes: wav.byteLength,
    seconds: check.frames / check.sampleRate,
    sampleRate: check.sampleRate,
    channels: check.channels,
    peakDb: db(p),
    rmsDb: db(rms(left)),
  };
  return { blob: new Blob([wav], { type: 'audio/wav' }), report };
}

export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function projectToJson(project: Project): Blob {
  return new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
}

export async function projectFromFile(file: File): Promise<Project> {
  if (file.size > 5_000_000) throw new Error('That file is too large to be a SPOOL project.');
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  return parseProject(data);
}
