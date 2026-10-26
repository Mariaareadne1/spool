import { useEffect, useRef, useState } from 'react';
import type { Project } from '../music/types';
import { degreeFromPosition } from '../gesture/controller';
import { hitTest, pitchRange, ringBounds, stepSize, toPolar } from './geometry';
import { SpoolRenderer } from './renderer';
import { useAppState, usePrefersReducedMotion, useSpool } from './context';
import { loopBeats } from '../music/types';

const PAD = 20;

function useSquare(ref: React.RefObject<HTMLElement | null>, pad: number): number {
  const [size, setSize] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(Math.max(0, Math.floor(Math.min(width, height) - pad * 2)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, pad]);
  return size;
}

/** Static render of a project (landing page preview). Same renderer, no interaction. */
export function SpoolPreview({ project, label }: { project: Project; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useSquare(box, 0);
  useEffect(() => {
    if (!canvas.current || size === 0) return;
    const r = new SpoolRenderer(canvas.current);
    r.resize(size, Math.min(2, window.devicePixelRatio || 1));
    r.draw(
      { project, base: project, activeTrack: 'pluck', mode: 'sculpt', selection: null, hover: null, edit: null, recording: false },
      { position: null, held: [], cursor: null, reducedMotion: true, now: 0 },
    );
  }, [project, size]);
  return (
    <div ref={box} style={{ width: '100%', height: '100%', minWidth: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  );
}

interface DragView {
  x: number;
  y: number;
}

/** The interactive spool: draws the live composition and handles pointer play + sculpting. */
export function Spool() {
  const app = useSpool();
  const state = useAppState();
  const reduced = usePrefersReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<SpoolRenderer | null>(null);
  const size = useSquare(box, PAD);
  const hoverRef = useRef<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dragView, setDragView] = useState<DragView | null>(null);
  const playingDegree = useRef<number | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    renderer.current = new SpoolRenderer(canvas.current);
  }, []);

  useEffect(() => {
    const r = renderer.current;
    if (!r || size === 0) return;
    r.resize(size, Math.min(2, window.devicePixelRatio || 1));
    app.stage = { size, layout: r.layout };
  }, [size, app]);

  // render loop: reads the controller directly every frame (no React re-render per frame)
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const r = renderer.current;
      const s = app.getSnapshot();
      if (r) {
        const engine = app.engine;
        const position = engine?.isPlaying ? engine.loopPosition() : null;
        r.draw(
          {
            project: app.playbackProject(),
            base: s.history.present,
            activeTrack: s.activeTrack,
            mode: s.mode,
            selection: s.selection,
            hover: hoverRef.current,
            edit: s.edit,
            recording: s.recording,
          },
          {
            position,
            held: s.held,
            cursor: s.input === 'camera' && s.mode === 'sculpt' ? app.handStagePoint() : null,
            reducedMotion: reduced,
            now: performance.now(),
          },
        );
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [app, reduced]);

  const local = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Perform mode: the active ring is playable — radius is pitch. */
  const degreeAt = (x: number, y: number): number | null => {
    const stage = app.stage;
    if (!stage) return null;
    const project = app.project;
    const polar = toPolar(stage.layout, x, y, loopBeats(project));
    const { inner, outer } = ringBounds(stage.layout, app.getSnapshot().activeTrack);
    if (polar.r < inner - 6 || polar.r > outer + 6) return null;
    const range = pitchRange(project);
    const pos = (polar.r - inner - stage.layout.band * 0.08) / (stepSize(stage.layout, project) * (range.hi - range.lo));
    return degreeFromPosition(Math.min(1, Math.max(0, pos)), range, playingDegree.current);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    if (state.mode === 'sculpt') {
      if (app.sculptDown(x, y)) {
        canvas.current!.setPointerCapture(e.pointerId);
        setDragView({ x, y });
      }
      return;
    }
    const degree = degreeAt(x, y);
    if (degree === null) return;
    canvas.current!.setPointerCapture(e.pointerId);
    playingDegree.current = degree;
    app.noteOn('stage', degree, 0.8);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    if (state.mode === 'sculpt') {
      if (dragView) {
        app.sculptMove(x, y);
        setDragView({ x, y });
        return;
      }
      const stage = app.stage;
      const hit = stage ? hitTest(stage.layout, app.project, x, y, 12) : null;
      const id = hit?.phraseId ?? null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        setHover(id);
      }
      return;
    }
    if (playingDegree.current === null) return;
    const degree = degreeAt(x, y);
    if (degree !== null && degree !== playingDegree.current) {
      playingDegree.current = degree;
      app.noteOn('stage', degree, 0.8);
    }
  };

  const onPointerUp = () => {
    if (dragView) {
      app.sculptUp();
      setDragView(null);
    }
    if (playingDegree.current !== null) {
      playingDegree.current = null;
      app.noteOff('stage');
    }
  };

  const edit = state.edit;
  const empty = app.project.notes.length === 0 && !state.take?.notes.length;

  return (
    <div className="stage" data-mode={state.mode} data-hover={hover !== null} data-dragging={dragView !== null} ref={box}>
      <canvas
        ref={canvas}
        data-testid="spool-canvas"
        role="img"
        aria-label={`Circular score: ${app.project.notes.length} notes in ${app.project.phrases.length} phrases`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!dragView) {
            hoverRef.current = null;
            setHover(null);
          }
        }}
      />
      {empty && state.mode === 'perform' && !(state.input === 'camera' && !state.handsVisible) && (
        <div className="stage__empty">
          <div className="stage__empty-inner">
            <em>An empty spool.</em>
            {state.input === 'camera' ? 'Pinch to play · raise your other hand, palm open, to record.' : 'Play the rail or keys A–; · press R to wind your first phrase.'}
          </div>
        </div>
      )}
      {edit && dragView && (
        <div className="readout" style={{ left: dragView.x + (box.current ? (box.current.clientWidth - size) / 2 : 0), top: dragView.y + (box.current ? (box.current.clientHeight - size) / 2 : 0) }}>
          <span>pitch</span>
          <b>{edit.steps > 0 ? `+${edit.steps}` : edit.steps} st</b>
          <span>time</span>
          <b>{edit.beats > 0 ? `+${edit.beats}` : edit.beats} bt</b>
          {edit.factor !== 1 && (
            <>
              <span>len</span>
              <b>×{edit.factor}</b>
            </>
          )}
        </div>
      )}
    </div>
  );
}
