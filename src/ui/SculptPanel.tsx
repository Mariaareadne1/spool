import { phraseNotes, STRETCH_FACTORS } from '../music/transform';
import { useAppState, useSpool } from './context';
import { TrashIcon } from './icons';
import { THREAD } from './theme';

/** Sculpt controls for the selected phrase — lives in the side column so it never covers the score. */
export function SculptPanel() {
  const app = useSpool();
  const state = useAppState();
  if (state.mode !== 'sculpt') return null;
  const project = state.history.present;
  const phrase = project.phrases.find((p) => p.id === state.selection);
  if (!phrase) {
    return (
      <div className="sculpt-panel" data-testid="sculpt-panel">
        <h3>Sculpt</h3>
        <p>{project.phrases.length ? 'Grab a thread to select its whole phrase. Drag around the circle to move it in time, in or out to transpose.' : 'Nothing to sculpt yet — record a phrase in Perform mode first.'}</p>
      </div>
    );
  }
  const th = THREAD[phrase.track];
  const notes = phraseNotes(project, phrase.id);
  return (
    <div className="sculpt-panel" data-testid="sculpt-panel">
      <h3>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: th.color, display: 'inline-block' }} />
        {th.name} · phrase {phrase.ordinal}
      </h3>
      <p>{notes.length} notes · grab and drag on the spool, or:</p>
      <div className="sculpt-grid">
        <span className="label">Pitch</span>
        <div className="seg">
          <button onClick={() => app.nudge({ steps: -1 })} aria-label="Transpose down one step" data-testid="nudge-down">−1</button>
          <button onClick={() => app.nudge({ steps: 1 })} aria-label="Transpose up one step" data-testid="nudge-up">+1</button>
        </div>
        <span className="label">Time</span>
        <div className="seg">
          <button onClick={() => app.nudge({ beats: -0.25 })} aria-label="Earlier by a sixteenth">−1/16</button>
          <button onClick={() => app.nudge({ beats: 0.25 })} aria-label="Later by a sixteenth" data-testid="nudge-later">+1/16</button>
          <button onClick={() => app.nudge({ beats: 1 })} aria-label="Later by a beat">+1</button>
        </div>
        <span className="label">Length</span>
        <div className="seg">
          {STRETCH_FACTORS.filter((f) => f !== 1).map((f) => (
            <button key={f} onClick={() => app.nudge({ factor: f })} aria-label={`Stretch by ${f}`} data-testid={`stretch-${f}`}>×{f}</button>
          ))}
        </div>
      </div>
      <button className="btn btn--ghost" style={{ justifySelf: 'start', paddingLeft: 0 }} onClick={() => app.deleteSelected()}>
        <TrashIcon /> Remove phrase
      </button>
    </div>
  );
}
