import { useEffect, useState } from 'react';
import { BAR_OPTIONS, BPM_RANGE } from '../music/project';
import { NOTE_NAMES, SCALE_LABELS, SCALES, type ScaleName } from '../music/theory';
import { useAppState, useSpool } from './context';
import { CameraIcon, PlayIcon, RedoIcon, StopIcon, UndoIcon } from './icons';

function Position() {
  const app = useSpool();
  const [pos, setPos] = useState({ bar: 1, beat: 1 });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const e = app.engine;
      const p = e?.isPlaying ? e.loopPosition() : 0;
      const bpb = app.project.beatsPerBar;
      const bar = Math.floor(p / bpb) + 1;
      const beat = Math.floor(p % bpb) + 1;
      setPos((prev) => (prev.bar === bar && prev.beat === beat ? prev : { bar, beat }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [app]);
  return (
    <div className="position hide-sm" aria-live="off" data-testid="position">
      <span>BAR <b>{pos.bar}</b>/{app.project.bars}</span>
      <span>BEAT <b>{pos.beat}</b></span>
    </div>
  );
}

export function Transport() {
  const app = useSpool();
  const state = useAppState();
  const p = state.history.present;

  return (
    <footer className="transport" aria-label="Transport">
      <div className="transport__group">
        <button className="play" onClick={() => void app.togglePlay()} aria-label={state.playing ? 'Stop (Space)' : 'Play (Space)'} data-testid="play">
          {state.playing ? <StopIcon /> : <PlayIcon />}
        </button>
        <button className="record" aria-pressed={state.recording} onClick={() => void app.toggleRecord()} data-testid="record">
          <span className="record__dot" />
          {state.recording ? `Recording · ${state.take?.notes.length ?? 0}` : 'Record'}
          <span className="kbd hide-sm">R</span>
        </button>
      </div>
      <Position />
      <span className="transport__sep" />
      <div className="field">
        <span className="label hide-sm">Tempo</span>
        <div className="stepper">
          <button aria-label="Slower" onClick={() => app.setBpm(p.bpm - 4)} disabled={p.bpm <= BPM_RANGE.min}>−</button>
          <output data-testid="bpm">{p.bpm}</output>
          <button aria-label="Faster" onClick={() => app.setBpm(p.bpm + 4)} disabled={p.bpm >= BPM_RANGE.max}>+</button>
        </div>
      </div>
      <div className="field hide-sm">
        <span className="label">Loop</span>
        <select value={p.bars} onChange={(e) => app.setBars(Number(e.target.value))} aria-label="Loop length in bars" data-testid="bars">
          {BAR_OPTIONS.map((b) => <option key={b} value={b}>{b} bar{b > 1 ? 's' : ''}</option>)}
        </select>
      </div>
      <div className="field">
        <span className="label hide-md">Key</span>
        <select value={p.root} onChange={(e) => app.setKey(Number(e.target.value), p.scale)} aria-label="Key" data-testid="key-root">
          {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        <select value={p.scale} onChange={(e) => app.setKey(p.root, e.target.value as ScaleName)} aria-label="Scale" data-testid="key-scale">
          {(Object.keys(SCALES) as ScaleName[]).map((s) => <option key={s} value={s}>{SCALE_LABELS[s]}</option>)}
        </select>
      </div>
      <div className="transport__spacer" />
      <div className="transport__group hide-sm">
        <button className="toggle" aria-pressed={state.metronome} onClick={() => app.setMetronome(!state.metronome)}>Click</button>
        <button className="toggle" aria-pressed={state.snap} onClick={() => app.setSnap(!state.snap)} title="Snap recorded notes to 1/16">Snap</button>
        <button
          className="toggle"
          aria-pressed={state.input === 'camera'}
          onClick={() => (state.input === 'camera' ? app.stopCamera() : void app.startCamera())}
          data-testid="toggle-camera"
        >
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><CameraIcon /> Hands</span>
        </button>
      </div>
      <span className="transport__sep hide-sm" />
      <div className="transport__group">
        <button className="icon-btn" onClick={() => app.undo()} disabled={!app.canUndo} aria-label="Undo (⌘Z)" data-testid="undo"><UndoIcon /></button>
        <button className="icon-btn" onClick={() => app.redo()} disabled={!app.canRedo} aria-label="Redo (⇧⌘Z)" data-testid="redo"><RedoIcon /></button>
      </div>
    </footer>
  );
}
