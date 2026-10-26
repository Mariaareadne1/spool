import { TRACK_IDS } from '../music/types';
import { useAppState, useSpool } from './context';
import { THREAD } from './theme';

const PERFORM_HINTS_POINTER: [string, string][] = [
  ['Play', 'rail · ring · A–;'],
  ['Octave up', 'hold ⇧'],
  ['Record a phrase', 'R'],
  ['Play / stop', 'Space'],
  ['Thread', '1–4'],
];
const PERFORM_HINTS_CAMERA: [string, string][] = [
  ['Play', 'pinch'],
  ['Pitch', 'hand height'],
  ['Louder', 'lean in'],
  ['Record', 'other palm open, hold'],
];
const SCULPT_HINTS: [string, string][] = [
  ['Select', 'click a thread'],
  ['Transpose', 'drag in / out · ↑↓'],
  ['Shift in time', 'drag around · ←→'],
  ['Stretch', '[ and ]'],
  ['Remove', '⌫'],
];
const SCULPT_HINTS_CAMERA: [string, string][] = [
  ['Grab', 'pinch on a thread'],
  ['Transpose / shift', 'move while pinched'],
  ['Stretch', 'pinch both hands, spread'],
];

export function Side() {
  const app = useSpool();
  const state = useAppState();
  const project = state.history.present;
  const counts = Object.fromEntries(TRACK_IDS.map((t) => [t, project.notes.filter((n) => n.track === t).length]));
  const camera = state.input === 'camera';
  const hints = state.mode === 'sculpt' ? (camera ? SCULPT_HINTS_CAMERA : SCULPT_HINTS) : camera ? PERFORM_HINTS_CAMERA : PERFORM_HINTS_POINTER;

  return (
    <aside className="side" aria-label="Mode and threads">
      <div className="modes" data-mode={state.mode} role="group" aria-label="Mode">
        <span className="modes__thumb" aria-hidden />
        <button aria-pressed={state.mode === 'perform'} onClick={() => app.setMode('perform')} data-testid="mode-perform">Perform</button>
        <button aria-pressed={state.mode === 'sculpt'} onClick={() => app.setMode('sculpt')} data-testid="mode-sculpt">Sculpt</button>
      </div>

      <section>
        <div className="section-head">
          <span className="label">Threads</span>
          <span className="label">{project.notes.length} notes</span>
        </div>
        <ul className="tracks">
          {TRACK_IDS.map((t, i) => {
            const th = THREAD[t];
            const muted = project.tracks[t].muted;
            return (
              <li key={t}>
                <div
                  className="track"
                  role="button"
                  tabIndex={0}
                  aria-pressed={state.activeTrack === t}
                  data-muted={muted}
                  data-testid={`track-${t}`}
                  style={{ '--c': th.color } as React.CSSProperties}
                  onClick={() => app.selectTrack(t)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), app.selectTrack(t))}
                >
                  <span className="track__swatch">{i + 1}</span>
                  <span>
                    <span className="track__name">{th.name}</span>
                    <span className="track__meta">{th.blurb}</span>
                  </span>
                  <span className="track__end">
                    <span className="track__count">{counts[t] || ''}</span>
                    <button
                      className="mute"
                      aria-pressed={muted}
                      aria-label={`${muted ? 'Unmute' : 'Mute'} ${th.name}`}
                      data-testid={`mute-${t}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        app.toggleMute(t);
                      }}
                    >
                      M
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="hints" aria-label="Controls">
        <span className="label">{state.mode === 'sculpt' ? 'Sculpt' : 'Perform'} · {camera ? 'hands' : 'pointer & keys'}</span>
        {hints.map(([a, b]) => (
          <div className="hint-row" key={a}>
            <span>{a}</span>
            <span>{b}</span>
          </div>
        ))}
      </section>
    </aside>
  );
}
