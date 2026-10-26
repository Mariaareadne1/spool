import { isScaleName, type ScaleName } from './theory';
import { TRACK_IDS, type Note, type Phrase, type Project, type TrackId, type TrackState } from './types';

export const BPM_RANGE = { min: 60, max: 160 } as const;
export const BAR_OPTIONS = [1, 2, 4] as const;

let counter = 0;
export function makeId(prefix: string): string {
  counter = (counter + 1) % 1e6;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

function defaultTracks(): Record<TrackId, TrackState> {
  return { glass: { muted: false, gain: 0.8 }, pluck: { muted: false, gain: 0.9 }, pad: { muted: false, gain: 0.7 }, bass: { muted: false, gain: 0.9 } };
}

export function createProject(overrides: Partial<Pick<Project, 'name' | 'bpm' | 'bars' | 'root' | 'scale'>> = {}): Project {
  const now = Date.now();
  return {
    schema: 1,
    id: makeId('prj'),
    name: overrides.name ?? 'Untitled spool',
    bpm: overrides.bpm ?? 92,
    bars: overrides.bars ?? 2,
    beatsPerBar: 4,
    root: overrides.root ?? 2,
    scale: overrides.scale ?? 'dorian',
    tracks: defaultTracks(),
    notes: [],
    phrases: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function nextOrdinal(project: Project, track: TrackId): number {
  return project.phrases.filter((p) => p.track === track).reduce((m, p) => Math.max(m, p.ordinal), 0) + 1;
}

export function addPhrase(project: Project, phrase: Phrase, notes: readonly Note[]): Project {
  if (notes.length === 0) return project;
  return {
    ...project,
    phrases: [...project.phrases.filter((p) => p.id !== phrase.id), phrase],
    notes: [...project.notes.filter((n) => n.phraseId !== phrase.id), ...notes],
    updatedAt: Date.now(),
  };
}

export function updateSettings(
  project: Project,
  patch: Partial<Pick<Project, 'name' | 'bpm' | 'bars' | 'root' | 'scale'>>,
): Project {
  const bpm = patch.bpm === undefined ? project.bpm : clamp(Math.round(patch.bpm), BPM_RANGE.min, BPM_RANGE.max);
  return { ...project, ...patch, bpm, updatedAt: Date.now() };
}

export function setTrack(project: Project, track: TrackId, patch: Partial<TrackState>): Project {
  return { ...project, tracks: { ...project.tracks, [track]: { ...project.tracks[track], ...patch } }, updatedAt: Date.now() };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------- validation (projects come back from localStorage and user-imported JSON) ----------

export class ProjectFormatError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isTrack = (v: unknown): v is TrackId => typeof v === 'string' && (TRACK_IDS as readonly string[]).includes(v);

function fail(msg: string): never {
  throw new ProjectFormatError(msg);
}

export function parseProject(input: unknown): Project {
  if (!isObj(input)) fail('Project is not an object');
  if (input.schema !== 1) fail('Unsupported project version');
  const { id, name, bpm, bars, beatsPerBar, root, scale, tracks, notes, phrases } = input;
  if (typeof id !== 'string' || typeof name !== 'string') fail('Project is missing id or name');
  if (!isNum(bpm) || bpm < BPM_RANGE.min || bpm > BPM_RANGE.max) fail('Tempo out of range');
  if (!isNum(bars) || !(BAR_OPTIONS as readonly number[]).includes(bars)) fail('Unsupported loop length');
  if (beatsPerBar !== 4) fail('Unsupported meter');
  if (!isNum(root) || root < 0 || root > 11 || !Number.isInteger(root)) fail('Invalid key');
  if (!isScaleName(scale)) fail('Unknown scale');
  if (!isObj(tracks)) fail('Missing tracks');
  const parsedTracks = defaultTracks();
  for (const t of TRACK_IDS) {
    const s = tracks[t];
    if (!isObj(s) || typeof s.muted !== 'boolean' || !isNum(s.gain)) fail(`Invalid track ${t}`);
    parsedTracks[t] = { muted: s.muted, gain: clamp(s.gain, 0, 1.5) };
  }
  if (!Array.isArray(phrases) || !Array.isArray(notes)) fail('Missing notes or phrases');
  const loop = bars * 4;
  const phraseTrack = new Map<string, TrackId>();
  const allPhrases: Phrase[] = phrases.map((p) => {
    if (!isObj(p) || typeof p.id !== 'string' || !isTrack(p.track) || !isNum(p.ordinal) || !isNum(p.anchor)) fail('Invalid phrase');
    if (phraseTrack.has(p.id)) fail('Duplicate phrase id');
    phraseTrack.set(p.id, p.track);
    return { id: p.id, track: p.track, ordinal: p.ordinal, anchor: ((p.anchor % loop) + loop) % loop };
  });
  const noteIds = new Set<string>();
  const parsedNotes: Note[] = notes.map((n) => {
    if (!isObj(n) || typeof n.id !== 'string' || typeof n.phraseId !== 'string' || !isTrack(n.track)) fail('Invalid note');
    if (noteIds.has(n.id)) fail('Duplicate note id');
    noteIds.add(n.id);
    const track = phraseTrack.get(n.phraseId);
    if (!track) fail('Note references a missing phrase');
    if (track !== n.track) fail('Note track does not match its phrase');
    if (!isNum(n.start) || !isNum(n.duration) || !isNum(n.degree) || !isNum(n.velocity)) fail('Invalid note timing');
    if (n.start < 0 || n.start >= loop || n.duration <= 0) fail('Note outside the loop');
    return {
      id: n.id,
      phraseId: n.phraseId,
      track: n.track,
      start: n.start,
      duration: Math.min(n.duration, loop),
      degree: Math.round(clamp(n.degree, -24, 36)),
      velocity: clamp(n.velocity, 0, 1),
    };
  });
  const used = new Set(parsedNotes.map((n) => n.phraseId));
  const parsedPhrases = allPhrases.filter((p) => used.has(p.id));
  const createdAt = isNum(input.createdAt) ? input.createdAt : Date.now();
  const updatedAt = isNum(input.updatedAt) ? input.updatedAt : createdAt;
  return {
    schema: 1, id, name: name.slice(0, 80), bpm, bars, beatsPerBar: 4, root, scale: scale as ScaleName,
    tracks: parsedTracks, notes: parsedNotes, phrases: parsedPhrases, createdAt, updatedAt,
  };
}
