/** Immutable undo/redo stack. Each entry is a whole value, so undo is O(1) and can never desync. */
export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

/** Replace the present without creating an undo step (e.g. autosave timestamps, live drags). */
export function replace<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;
