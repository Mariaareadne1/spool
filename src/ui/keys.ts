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

/**
 * How the currently focused element got focus. `:focus-visible` can't answer
 * this: browsers switch it on as soon as any key is pressed. So we record the
 * last input modality and stamp it on each focus change.
 */
let lastInput: 'pointer' | 'keyboard' = 'pointer';
let focusedByKeyboard = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) lastInput = 'keyboard'; }, true);
  window.addEventListener('focusin', () => { focusedByKeyboard = lastInput === 'keyboard'; }, true);
}

/**
 * A control the user reached with the keyboard owns Space and Enter. A button
 * merely clicked with the mouse does not, so Space still means play/stop.
 */
export function isKeyboardFocusedControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const control = target.closest('button, a[href], [role="button"], [role="menuitem"], summary');
  return !!control && focusedByKeyboard;
}
