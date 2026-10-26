import { useEffect, useRef, useState } from 'react';
import { useAppState, useSpool } from './context';
import { ChevronIcon, DownloadIcon } from './icons';

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function ago(ts: number | null): string {
  if (!ts) return 'Not saved yet';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'Saved just now';
  if (s < 60) return `Saved ${s}s ago`;
  return `Saved ${Math.round(s / 60)}m ago`;
}

export function TopBar() {
  const app = useSpool();
  const state = useAppState();
  const project = state.history.present;
  const [name, setName] = useState(project.name);
  const [menu, setMenu] = useState<null | 'projects' | 'export'>(null);
  const [, setTick] = useState(0);
  const close = () => setMenu(null);
  const projectsRef = useDismiss(menu === 'projects', close);
  const exportRef = useDismiss(menu === 'export', close);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setName(project.name), [project.name]);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const exporting = state.busy === 'export';

  return (
    <header className="topbar">
      <div className="wordmark">
        Spool <span className="label">gestural loop instrument</span>
      </div>
      <div className="project-name">
        <label className="sr-only" htmlFor="project-name">Project name</label>
        <input
          id="project-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => app.setName(name)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="saved" data-testid="saved-status">{ago(state.lastSavedAt)}</span>
      </div>
      <div className="topbar__spacer" />
      <div className="menu" ref={projectsRef}>
        <button className="btn btn--ghost" aria-expanded={menu === 'projects'} onClick={() => setMenu(menu === 'projects' ? null : 'projects')} data-testid="projects-menu">
          Projects <ChevronIcon />
        </button>
        {menu === 'projects' && (
          <div className="menu__panel" role="menu">
            <button className="menu__item" role="menuitem" onClick={() => { app.save(); close(); }} data-testid="save">
              Save <small>⌘S</small>
            </button>
            <button className="menu__item" role="menuitem" onClick={() => { app.newProject(); close(); }}>
              New spool
            </button>
            <button className="menu__item" role="menuitem" onClick={() => { void app.openDemo(state.input); close(); }}>
              Open demo “First Light”
            </button>
            <button className="menu__item" role="menuitem" onClick={() => fileInput.current?.click()}>
              Import JSON…
            </button>
            {state.saved.length > 0 && (
              <>
                <div className="menu__sep" />
                <div className="label menu__heading">Saved in this browser</div>
                {state.saved.slice(0, 8).map((s) => (
                  <button key={s.id} className="menu__item" role="menuitem" disabled={s.id === project.id} onClick={() => { app.open(s.id); close(); }}>
                    <span>{s.name}{s.id === project.id ? ' · open' : ''}</span>
                    <small>{s.notes} notes</small>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void app.importJson(f);
          e.target.value = '';
          close();
        }}
      />
      <div className="menu" ref={exportRef}>
        <button className="btn" aria-expanded={menu === 'export'} disabled={exporting} onClick={() => setMenu(menu === 'export' ? null : 'export')} data-testid="export-menu">
          <DownloadIcon /> {exporting ? 'Rendering…' : 'Export'}
        </button>
        {menu === 'export' && (
          <div className="menu__panel" role="menu">
            <button className="menu__item" role="menuitem" disabled={project.notes.length === 0} onClick={() => { close(); void app.exportWav(); }} data-testid="export-wav">
              Audio · WAV <small>2 loops · 44.1 kHz · 16-bit</small>
            </button>
            <button className="menu__item" role="menuitem" onClick={() => { close(); app.exportJson(); }} data-testid="export-json">
              Project · JSON <small>re-importable</small>
            </button>
            {state.lastExport && (
              <>
                <div className="menu__sep" />
                <div className="label menu__heading">Last export, verified</div>
                <div className="menu__item" style={{ cursor: 'default' }}>
                  <span>{state.lastExport.fileName}</span>
                  <small>{state.lastExport.seconds.toFixed(1)}s · peak {state.lastExport.peakDb.toFixed(1)} dB</small>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
