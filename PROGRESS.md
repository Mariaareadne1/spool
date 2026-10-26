# SPOOL — progress log

_Last updated: 2026-10-26 (overnight autonomous build)._

## Status

Feature-complete for the core product. All automated checks pass (see Verification). The main unverified area is real-human gesture play with a physical camera.

| Area | State |
|---|---|
| Audio engine — 4 voices, mix graph, lookahead scheduler, metronome | Done, unit + browser tested |
| Recording — phrases, overdub, 1/16 snap, seam-crossing notes | Done, tested (keyboard and synthetic gestures) |
| Multi-track looping, mute | Done, tested |
| Circular score — rings, lanes, chord strands, playhead, held notes | Done, visually reviewed at 4 viewports |
| Pointer & keyboard play — rail, ring, home row | Done, tested |
| Hand tracking — MediaPipe, interpreter, controller, camera states | Done; logic tested with synthetic landmarks; real model loads with Chromium's fake camera; **not tried by a person** |
| Sculpt — select, drag transpose/shift, stretch, nudges, delete, undo/redo | Done, tested (mouse + synthetic gestures) |
| Persistence — autosave, save, open, new, JSON import/export, validation | Done, tested (save → reload) |
| WAV export — render, encode, self-check, report | Done, verified by PCM analysis + ffprobe |
| Responsive — 1440/1280/1024/390 | Done, no-overflow tested |
| Case study, README, diagram, real screenshots, real screen recording | Done |

## Verification (last run)

- `npx tsc -b` — clean
- `npm test` — 52/52 unit tests
- `npm run test:e2e` — 16/16 browser tests (dev server)
- `E2E_PROD=1 npm run test:e2e` — 12/12 at the time of the production run (before the 4 keyboard tests were added); re-run in final validation, see below
- `npm run build` — OK (main JS 95 KB gzip; MediaPipe chunk lazy)
- WAV: `case-study/demos/first-light.wav` — pcm_s16le, 44.1 kHz, 2 ch (ffprobe)

## Architecture

See `README.md` and `case-study/diagrams/architecture.svg`.

- `src/music/` — pure model: theory (degrees → Hz), types, project (create/validate), transform (transpose/shift/stretch/clamp), recorder, schedule (`notesInWindow`), history, demo
- `src/audio/` — voices, mix graph, live engine, offline render, WAV encode/decode, analysis (FFT pitch, spectral-flux onsets)
- `src/gesture/` — interpreter (landmarks → hand state), controller (hand state → commands), tracker (camera + MediaPipe)
- `src/state/` — app controller, storage, exporter, test hooks
- `src/ui/` — React components, canvas renderer, polar geometry, theme

## Decisions

- **No product spec or "existing foundation" was present in the session.** The directive refers to a product specification, an existing audio/gesture foundation and a reference repository, but none were included, and no SPOOL code existed locally or on GitHub (`Mariaareadne1`). The product was designed from the directive's own description (gesture input, multi-track loops, circular composition, Sculpt, save, WAV export). If a spec exists, compare it against this build.
- Pitch stored as scale degrees (in-key by construction).
- Raw Web Audio (no Tone.js) so the same graph runs live, offline and in Node tests.
- Hand roles by screen side + motion prediction, not MediaPipe's handedness label.
- Sculpt panel lives in the side column so it never covers the score.
- Mode toggle is `E`; `Tab` is left to focus navigation.
- Dev server port **5341** (5320 is used by `pon`).

## Blockers / needs the owner

1. **Repository is private.** Creating a *public* repo was refused by the session's permission classifier ("public surface"). It was created private instead: https://github.com/Mariaareadne1/spool. To publish:
   `gh repo edit Mariaareadne1/spool --visibility public --accept-visibility-change-consequences`
2. **No live deployment.** Not attempted, for the same reason (a deploy publishes the app). To deploy on Vercel: `npx vercel --prod` from the repo root (static Vite build, output `dist`), or connect the repo in the Vercel dashboard.
3. **No LICENSE file** — choosing a license is the owner's call.
4. **Real-camera play** needs a person: check pinch latency, threshold feel (`PINCH_ON/OFF`, `OPEN_ON/OFF` in `src/gesture/interpret.ts`), and the open-palm record dwell (900 ms).

## Known limitations

- Automated tests run in Chromium only; Firefox/Safari not exercised.
- Phone layout hides the key/scale selectors.
- Changing to a scale with fewer notes leaves notes above the new range drawn at the ring's edge (they still play correctly).
- The screen recording is silent (Playwright video has no audio); the exported WAV is provided separately.

## How to resume

```bash
cd ~/Development/spool
npm install
npm run dev            # http://localhost:5341
npm test && npm run test:e2e
node scripts/capture-demo.mjs   # re-record demo video + WAV (dev server running)
```

Next ideas, if continuing: real-camera tuning session; Firefox/Safari pass; per-phrase mute/solo; MIDI export; a "wind-in" animation for newly recorded threads; scale-change remapping of out-of-range notes.
