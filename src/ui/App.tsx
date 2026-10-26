import { useEffect } from 'react';
import { SCALES } from '../music/theory';
import { TRACK_IDS } from '../music/types';
import { useAppState, useSpool } from './context';
import { Instrument } from './Instrument';
import { degreeForKey, isTypingTarget } from './keys';
import { Landing } from './Landing';

/** Global keyboard: home row plays, Space/R transport, Tab mode, arrows sculpt. */
function useKeyboard() {
  const app = useSpool();
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = app.getSnapshot();
      if (s.screen !== 'instrument' || isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) app.redo();
        else app.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        app.save();
        return;
      }
      if (mod || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) void app.togglePlay();
        return;
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        app.setMode(s.mode === 'perform' ? 'sculpt' : 'perform');
        return;
      }
      if (/^Digit[1-4]$/.test(e.code)) {
        app.selectTrack(TRACK_IDS[Number(e.code.slice(5)) - 1]);
        return;
      }
      if (s.mode === 'perform') {
        if (e.code === 'KeyR' && !e.repeat) {
          void app.toggleRecord();
          return;
        }
        const degree = degreeForKey(e.code, e.key, e.shiftKey, SCALES[app.project.scale].length);
        if (degree !== null) {
          e.preventDefault();
          if (!e.repeat) app.noteOn(`key:${e.code}`, degree, 0.8);
        }
        return;
      }
      // sculpt
      const big = e.shiftKey;
      const map: Record<string, () => void> = {
        ArrowUp: () => app.nudge({ steps: big ? 7 : 1 }),
        ArrowDown: () => app.nudge({ steps: big ? -7 : -1 }),
        ArrowRight: () => app.nudge({ beats: big ? 1 : 0.25 }),
        ArrowLeft: () => app.nudge({ beats: big ? -1 : -0.25 }),
        BracketRight: () => app.nudge({ factor: 2 }),
        BracketLeft: () => app.nudge({ factor: 0.5 }),
        Backspace: () => app.deleteSelected(),
        Delete: () => app.deleteSelected(),
        Escape: () => app.selectPhrase(null),
      };
      const fn = map[e.code];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    const up = (e: KeyboardEvent) => {
      app.noteOff(`key:${e.code}`);
    };
    const blur = () => app.releaseAll();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [app]);
}

export function App() {
  const state = useAppState();
  useKeyboard();
  return state.screen === 'landing' ? <Landing /> : <Instrument />;
}
