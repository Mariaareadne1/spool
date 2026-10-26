import { parseProject } from '../music/project';
import type { Project } from '../music/types';

/**
 * Projects persist in localStorage: one key per project plus a small index.
 * Every read goes back through parseProject, so a corrupted or hand-edited
 * entry is rejected with a message instead of crashing the instrument.
 */

const INDEX_KEY = 'spool.index.v1';
const LAST_KEY = 'spool.last.v1';
const projectKey = (id: string) => `spool.project.v1.${id}`;

export interface SavedSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: number;
  readonly notes: number;
}

export class StorageError extends Error {}

function readIndex(): SavedSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedSummary =>
        typeof s === 'object' && s !== null && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.updatedAt === 'number' && typeof s.notes === 'number',
    );
  } catch {
    return [];
  }
}

export function listProjects(): SavedSummary[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveProject(project: Project): SavedSummary {
  const summary: SavedSummary = { id: project.id, name: project.name, updatedAt: Date.now(), notes: project.notes.length };
  try {
    localStorage.setItem(projectKey(project.id), JSON.stringify(project));
    localStorage.setItem(INDEX_KEY, JSON.stringify([summary, ...readIndex().filter((s) => s.id !== project.id)]));
    localStorage.setItem(LAST_KEY, project.id);
  } catch (err) {
    const quota = err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22);
    throw new StorageError(quota ? 'Browser storage is full — export the project as JSON instead.' : 'This browser blocked saving (private mode?).');
  }
  return summary;
}

export function loadProject(id: string): Project {
  let raw: string | null;
  try {
    raw = localStorage.getItem(projectKey(id));
  } catch {
    throw new StorageError('This browser blocked reading saved projects.');
  }
  if (!raw) throw new StorageError('That project is no longer saved in this browser.');
  try {
    return parseProject(JSON.parse(raw));
  } catch (err) {
    throw new StorageError(`Saved project is damaged: ${err instanceof Error ? err.message : 'unreadable'}`);
  }
}

export function deleteSaved(id: string): void {
  try {
    localStorage.removeItem(projectKey(id));
    localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((s) => s.id !== id)));
  } catch {
    throw new StorageError('This browser blocked changing saved projects.');
  }
}

export function lastOpenedId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function setLastOpened(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* non-essential convenience */
  }
}
