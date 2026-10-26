/** Home row plays the scale: A = degree 0 … ' = degree 10. Shift raises an octave. */
export const KEY_ROW = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"] as const;

export function degreeForKey(code: string, key: string, shift: boolean, scaleLength: number): number | null {
  const fromCode: Record<string, string> = {
    KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f', KeyG: 'g', KeyH: 'h', KeyJ: 'j', KeyK: 'k', KeyL: 'l', Semicolon: ';', Quote: "'",
  };
  const k = fromCode[code] ?? key.toLowerCase();
  const i = (KEY_ROW as readonly string[]).indexOf(k);
  if (i < 0) return null;
  return i + (shift ? scaleLength : 0);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}
