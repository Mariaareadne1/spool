import type { RawHand } from '../gesture/interpret';
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
    },
  });
}
