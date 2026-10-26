import { useMemo } from 'react';
import { demoProject } from '../music/demo';
import { useAppState, useSpool } from './context';
import { CameraIcon } from './icons';
import { SpoolPreview } from './Spool';

export function Landing() {
  const app = useSpool();
  const state = useAppState();
  const demo = useMemo(() => demoProject(), []);
  const current = state.history.present;
  const hasWork = current.notes.length > 0;
  const camOk = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  return (
    <main className="landing">
      <section className="landing__copy" aria-labelledby="title">
        <p className="label landing__eyebrow">A gestural loop instrument</p>
        <h1 className="landing__title" id="title">Spool</h1>
        <p className="landing__lede">Play melodies in the air, wind them around a circle, and sculpt the threads into a composition.</p>
        <ol className="steps">
          <li><span className="num">01</span><strong>Play</strong><span>Pinch to sound a note; the height of your hand is the pitch.</span></li>
          <li><span className="num">02</span><strong>Wind</strong><span>Record a phrase — it loops around the spool as a coloured thread.</span></li>
          <li><span className="num">03</span><strong>Sculpt</strong><span>Grab a thread to transpose, shift or stretch it. Export as WAV.</span></li>
        </ol>
        <div className="landing__actions">
          {camOk && (
            <button className="btn btn--solid" onClick={() => void app.start('camera')} data-testid="start-camera">
              <CameraIcon /> Play with your hands
            </button>
          )}
          <button className="btn" onClick={() => void app.start('pointer')} data-testid="start-pointer">
            Mouse &amp; keys
          </button>
        </div>
        <div className="landing__fine">
          {hasWork ? (
            <span>
              Continue <button onClick={() => void app.start('pointer')}>“{current.name}”</button> · {current.notes.length} notes
            </span>
          ) : (
            <button onClick={() => void app.openDemo('pointer')} data-testid="open-demo">Open the demo spool</button>
          )}
          <span>Camera frames stay on this device · headphones recommended</span>
        </div>
      </section>
      <div className="landing__visual">
        <SpoolPreview project={demo} label="The demo composition “First Light”, drawn as threads around a circular score" />
        <p className="landing__caption"><em>First Light</em><br />D dorian · 92 bpm · 4 threads</p>
      </div>
    </main>
  );
}
