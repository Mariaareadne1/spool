import type { RawHand } from '../gesture/interpret';
import { loopBeats } from '../music/types';
import { beatAngle, degreeRadius } from '../ui/geometry';
import type { SpoolApp } from './app';

/**
 * Deterministic hooks for browser tests. They expose state and the *real*
 * gesture entry point (handleHands) — synthetic landmarks travel the same path
 * as camera frames. Installed in dev builds, or in production with ?e2e.
 */
export function installTestHooks(app: SpoolApp): void {
  const enabled = import.meta.env.DEV || new URLSearchParams(location.search).has('e2e');
  if (!enabled) return;
  Object.assign(window, {
    __spool: {
      app,
      state: () => app.getSnapshot(),
      project: () => app.project,
      playback: () => app.playbackProject(),
      feedHands: (hands: RawHand[], t: number) => app.handleHands(hands, t),
      engine: () => {
        const e = app.engine;
        return e ? { playing: e.isPlaying, position: e.loopPosition(), activeVoices: e.activeVoices, state: e.ctx.state } : null;
      },
      stage: () => app.stage,
      /** Client coordinates of a point inside a note's thread (fraction 0..1 along it). */
      notePoint: (noteId: string, along = 0.5) => {
        const stage = app.stage;
        const project = app.playbackProject();
        const note = project.notes.find((n) => n.id === noteId);
        const canvas = document.querySelector('[data-testid="spool-canvas"]');
        if (!stage || !note || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const r = degreeRadius(stage.layout, project, note.track, note.degree);
        const a = beatAngle(note.start + note.duration * along, loopBeats(project));
        return { x: rect.left + stage.layout.cx + Math.cos(a) * r, y: rect.top + stage.layout.cy + Math.sin(a) * r };
      },
      /** Client coordinates for a polar point on the stage. */
      polarPoint: (r: number, beat: number) => {
        const stage = app.stage;
        const canvas = document.querySelector('[data-testid="spool-canvas"]');
        if (!stage || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const a = beatAngle(beat, loopBeats(app.project));
        return { x: rect.left + stage.layout.cx + Math.cos(a) * r, y: rect.top + stage.layout.cy + Math.sin(a) * r };
      },
    },
  });
}
