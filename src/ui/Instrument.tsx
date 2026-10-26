import { useEffect, useState } from 'react';
import { phraseNotes, STRETCH_FACTORS } from '../music/transform';
import { useAppState, useSpool } from './context';
import { CameraIcon, TrashIcon } from './icons';
import { Rail } from './Rail';
import { Side } from './Side';
import { Spool } from './Spool';
import { THREAD } from './theme';
import { TopBar } from './TopBar';
import { Transport } from './Transport';

function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 44 44" aria-hidden>
      <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(237,230,218,0.12)" strokeWidth="1.5" />
      <circle cx="22" cy="22" r="18" fill="none" stroke="#ede6da" strokeWidth="1.5" strokeDasharray="28 200" strokeLinecap="round" />
    </svg>
  );
}

/** Camera permission / loading / error states, laid over the stage. */
function CameraOverlay() {
  const app = useSpool();
  const state = useAppState();
  const t = state.tracker;
  if (state.input !== 'camera') return null;
  if (t.kind === 'requesting') {
    return (
      <div className="overlay" data-testid="camera-requesting">
        <div className="card">
          <CameraIcon />
          <h2>Allow the camera</h2>
          <p>SPOOL tracks 21 points on each hand, entirely in this browser. No video is recorded or sent anywhere.</p>
        </div>
      </div>
    );
  }
  if (t.kind === 'loading') {
    return (
      <div className="overlay" data-testid="camera-loading">
        <div className="card">
          <Spinner />
          <h2>Learning your hands</h2>
          <p>Loading the hand-tracking model (7.8 MB, cached after the first visit).</p>
        </div>
      </div>
    );
  }
  if (t.kind === 'error') {
    return (
      <div className="overlay" data-testid="camera-error">
        <div className="card">
          <h2>{t.reason === 'denied' ? 'Camera declined' : t.reason === 'no-camera' ? 'No camera found' : 'Tracking unavailable'}</h2>
          <p>{t.message} Everything still works with the pitch rail, the ring itself, and the keyboard.</p>
          <div className="actions">
            <button className="btn btn--solid" onClick={() => app.stopCamera()} data-testid="camera-fallback">Continue with mouse &amp; keys</button>
            {t.reason !== 'unsupported' && <button className="btn" onClick={() => void app.startCamera()}>Try again</button>}
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function HandCoach() {
  const state = useAppState();
  const [show, setShow] = useState(false);
  const running = state.input === 'camera' && state.tracker.kind === 'running';
  useEffect(() => {
    if (!running || state.handsVisible) {
      setShow(false);
      return;
    }
    const id = window.setTimeout(() => setShow(true), 1500);
    return () => window.clearTimeout(id);
  }, [running, state.handsVisible]);
  if (!show) return null;
  return (
    <div className="hand-coach" data-testid="no-hands">
      <em>Raise a hand into view</em>
      Hold it about an arm’s length from the camera, palm facing you.
    </div>
  );
}

function SculptPanel() {
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
          <button onClick={() => app.nudge({ beats: -0.25 })} aria-label="Earlier by a sixteenth">−⅟16</button>
          <button onClick={() => app.nudge({ beats: 0.25 })} aria-label="Later by a sixteenth" data-testid="nudge-later">+⅟16</button>
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

function ToastView() {
  const state = useAppState();
  if (!state.toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite" data-tone={state.toast.tone} key={state.toast.id} data-testid="toast">
      <span className="dot" />
      {state.toast.text}
    </div>
  );
}

export function Instrument() {
  return (
    <div className="instrument">
      <TopBar />
      <Side />
      <main className="stage-wrap">
        <Spool />
        <SculptPanel />
        <CameraOverlay />
        <HandCoach />
      </main>
      <Rail />
      <Transport />
      <ToastView />
    </div>
  );
}
