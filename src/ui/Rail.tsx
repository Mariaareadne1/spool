import { useEffect, useRef, useState } from 'react';
import { degreeFromPosition } from '../gesture/controller';
import { noteMidi } from '../audio/mix';
import { midiToName, SCALES } from '../music/theory';
import { pitchRange } from './geometry';
import { KEY_ROW } from './keys';
import { useAppState, useSpool } from './context';
import { THREAD } from './theme';

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

function CameraView() {
  const app = useSpool();
  const state = useAppState();
  const holder = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const video = app.cameraVideo;
    const el = holder.current;
    if (!video || !el) return;
    el.prepend(video);
    return () => video.remove();
  }, [app, state.tracker.kind]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      const c = overlay.current;
      const g = c?.getContext('2d');
      if (c && g) {
        const w = (c.width = c.clientWidth * 2);
        const h = (c.height = c.clientHeight * 2);
        g.clearRect(0, 0, w, h);
        const view = app.gestureView;
        for (const hand of view.frame?.hands ?? []) {
          const color = hand.role === 'play' ? THREAD[app.getSnapshot().activeTrack].color : '#ede6da';
          g.strokeStyle = color;
          g.lineWidth = 2;
          g.globalAlpha = 0.9;
          for (const [a, b] of BONES) {
            g.beginPath();
            g.moveTo(hand.points[a].x * w, hand.points[a].y * h);
            g.lineTo(hand.points[b].x * w, hand.points[b].y * h);
            g.stroke();
          }
          g.beginPath();
          g.arc(hand.x * w, hand.y * h, hand.pinched ? 9 : 5, 0, Math.PI * 2);
          g.fillStyle = color;
          g.fill();
          if (hand.role === 'control' && view.recordHold > 0) {
            g.beginPath();
            g.arc(hand.points[9].x * w, hand.points[9].y * h, 26, -Math.PI / 2, -Math.PI / 2 + view.recordHold * Math.PI * 2);
            g.strokeStyle = '#ff5a4e';
            g.lineWidth = 4;
            g.stroke();
          }
        }
      }
      if (t - last > 500) {
        last = t;
        setFps(Math.round(app.trackerFps));
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [app]);

  const running = state.tracker.kind === 'running';
  const hands = app.gestureView.frame?.hands.length ?? 0;
  return (
    <div className="camera" ref={holder} data-testid="camera-view">
      <canvas ref={overlay} />
      <div className="camera__status">
        <span className="dot" data-on={running && state.handsVisible} />
        {running ? (state.handsVisible ? `${hands} hand${hands === 1 ? '' : 's'} · ${fps} fps` : 'no hands') : state.tracker.kind}
      </div>
    </div>
  );
}

export function Rail() {
  const app = useSpool();
  const state = useAppState();
  const project = state.history.present;
  const range = pitchRange(project);
  const octave = SCALES[project.scale].length;
  const strings = useRef<HTMLDivElement>(null);
  const current = useRef<number | null>(null);
  const [aim, setAim] = useState<number | null>(null);
  const color = THREAD[state.activeTrack].color;

  // gesture aim (camera): poll the controller each frame, re-render only on change
  useEffect(() => {
    if (state.input !== 'camera') return;
    let raf = 0;
    let prev: number | null = null;
    const tick = () => {
      const d = app.getSnapshot().mode === 'perform' && app.gestureView.frame?.play ? app.gestureView.degree : null;
      if (d !== prev) {
        prev = d;
        setAim(d);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [app, state.input]);

  const degreeAt = (e: React.PointerEvent): number => {
    const r = strings.current!.getBoundingClientRect();
    const horizontal = r.width > r.height;
    const pos = horizontal ? (e.clientX - r.left) / r.width : 1 - (e.clientY - r.top) / r.height;
    // strings are equal-height cells: map to the cell centre grid
    const cells = range.hi - range.lo + 1;
    const cont = Math.min(cells - 1, Math.max(0, Math.floor(pos * cells)));
    return degreeFromPosition(cont / (cells - 1), range, null);
  };

  const held = new Set(state.held.filter((h) => h.track === state.activeTrack).map((h) => h.degree));
  const list = [];
  for (let d = range.lo; d <= range.hi; d++) list.push(d);

  return (
    <aside className="rail" aria-label="Pitch rail">
      {state.input === 'camera' && <CameraView />}
      <div className="rail__head">
        <span className="label" style={{ color }}>{THREAD[state.activeTrack].name}</span>
        <span className="label">pitch</span>
      </div>
      <div
        className="rail__strings"
        ref={strings}
        data-testid="rail"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const d = degreeAt(e);
          current.current = d;
          app.noteOn('rail', d, 0.8);
        }}
        onPointerMove={(e) => {
          if (current.current === null) return;
          const d = degreeAt(e);
          if (d !== current.current) {
            current.current = d;
            app.noteOn('rail', d, 0.8);
          }
        }}
        onPointerUp={() => {
          current.current = null;
          app.noteOff('rail');
        }}
        onPointerCancel={() => {
          current.current = null;
          app.noteOff('rail');
        }}
      >
        {list.map((d) => {
          const midi = noteMidi(project, { track: state.activeTrack, degree: d });
          const keyIdx = d - range.lo;
          return (
            <div
              key={d}
              className="string"
              data-degree={d}
              data-tonic={d % octave === 0}
              data-hot={held.has(d)}
              data-aim={aim === d}
              style={{ '--c': color } as React.CSSProperties}
            >
              <span>{midiToName(midi)}</span>
              <span className="key">{KEY_ROW[keyIdx] ?? ''}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
