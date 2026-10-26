import { AudioEngine, type LiveHandle } from '../audio/engine';
import { GestureController, type GestureCommand } from '../gesture/controller';
import { GestureInterpreter, type GestureFrame, type RawHand } from '../gesture/interpret';
import { HandTracker, type TrackerStatus } from '../gesture/tracker';
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from '../music/history';
import { demoProject } from '../music/demo';
import { addPhrase, createProject, setTrack, updateSettings } from '../music/project';
import { Recorder, type Take } from '../music/recorder';
import { quantize, type ScaleName } from '../music/theory';
import { deletePhrase, GRID, phraseNotes, sculptPhrase, STRETCH_FACTORS } from '../music/transform';
import { loopBeats, type Project, type TrackId } from '../music/types';
import { angleDelta, degreeRadius, hitTest, pitchRange, stepSize, toPolar, type Layout } from '../ui/geometry';
import { THREAD } from '../ui/theme';
import { download, projectFromFile, projectToJson, renderWav, safeFileName, type ExportReport } from './exporter';
import { listProjects, loadProject, saveProject, setLastOpened, lastOpenedId, StorageError, type SavedSummary } from './storage';

export type Screen = 'landing' | 'instrument';
export type InputKind = 'pointer' | 'camera';
export type Mode = 'perform' | 'sculpt';

export interface HeldNote {
  readonly source: string;
  readonly track: TrackId;
  readonly degree: number;
  readonly handle: LiveHandle;
  /** Loop beat at note-on (null if the transport was stopped). */
  readonly beat: number | null;
}

export interface SculptEdit {
  readonly phraseId: string;
  readonly steps: number;
  readonly beats: number;
  readonly factor: number;
}

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'ok' | 'error';
}

export interface AppState {
  readonly screen: Screen;
  readonly input: InputKind;
  readonly mode: Mode;
  readonly activeTrack: TrackId;
  readonly history: History<Project>;
  readonly playing: boolean;
  readonly recording: boolean;
  readonly take: Take | null;
  readonly held: readonly HeldNote[];
  readonly selection: string | null;
  readonly edit: SculptEdit | null;
  readonly tracker: TrackerStatus;
  readonly handsVisible: boolean;
  readonly snap: boolean;
  readonly metronome: boolean;
  readonly lefty: boolean;
  readonly toast: Toast | null;
  readonly busy: 'export' | null;
  readonly saved: readonly SavedSummary[];
  readonly lastExport: ExportReport | null;
  readonly lastSavedAt: number | null;
}

export interface StageMap {
  readonly size: number;
  readonly layout: Layout;
}

interface DragState {
  phraseId: string;
  r0: number;
  lastTheta: number;
  turn: number;
  auditionDegree: number;
}

const AUTOSAVE_MS = 700;

function initialProject(): Project {
  const id = lastOpenedId();
  if (id) {
    try {
      return loadProject(id);
    } catch {
      /* fall through to a fresh project */
    }
  }
  return createProject();
}

/**
 * The application controller. Owns the authoritative state (an immutable
 * snapshot replaced on every change, consumed by React via
 * useSyncExternalStore) plus the imperative parts — audio engine, recorder,
 * hand tracker — that must not live in React.
 */
export class SpoolApp {
  private state: AppState;
  private listeners = new Set<() => void>();
  engine: AudioEngine | null = null;
  private recorder: Recorder | null = null;
  private tracker: HandTracker | null = null;
  private interpreter = new GestureInterpreter();
  private gestures = new GestureController();
  private drag: DragState | null = null;
  private autosaveTimer: number | null = null;
  private toastTimer: number | null = null;
  private toastId = 0;
  private lastHandsAt = 0;
  /** Latest gesture frame for the canvas and camera overlay (read in rAF, not via React). */
  gestureView: { frame: GestureFrame | null; recordHold: number; degree: number | null } = { frame: null, recordHold: 0, degree: null };
  stage: StageMap | null = null;

  constructor() {
    this.state = {
      screen: 'landing',
      input: 'pointer',
      mode: 'perform',
      activeTrack: 'pluck',
      history: createHistory(initialProject()),
      playing: false,
      recording: false,
      take: null,
      held: [],
      selection: null,
      edit: null,
      tracker: { kind: 'idle' },
      handsVisible: false,
      snap: true,
      metronome: false,
      lefty: false,
      toast: null,
      busy: null,
      saved: listProjects(),
      lastExport: null,
      lastSavedAt: null,
    };
  }

  // ---------- store plumbing ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): AppState => this.state;

  private set(patch: Partial<AppState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    if (prev.history !== this.state.history || prev.take !== this.state.take || prev.edit !== this.state.edit) {
      this.engine?.setProject(this.playbackProject());
    }
    if (prev.history.present !== this.state.history.present) this.scheduleAutosave();
    for (const fn of this.listeners) fn();
  }

  get project(): Project {
    return this.state.history.present;
  }

  /** What is heard and drawn: the project, plus the take being recorded, plus any live sculpt preview. */
  playbackProject(): Project {
    let p = this.project;
    const { take, edit } = this.state;
    if (take && take.notes.length) p = addPhrase(p, take.phrase, take.notes);
    if (edit) p = sculptPhrase(p, edit.phraseId, edit);
    return p;
  }

  private commitProject(next: Project): void {
    if (next === this.project) return;
    this.set({ history: commit(this.state.history, next) });
  }

  toast(text: string, tone: Toast['tone'] = 'info'): void {
    this.toastId += 1;
    this.set({ toast: { id: this.toastId, text, tone } });
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.set({ toast: null }), tone === 'error' ? 5200 : 3200);
  }

  // ---------- entering the instrument ----------

  private async ensureEngine(): Promise<AudioEngine> {
    if (!this.engine) {
      this.engine = new AudioEngine(this.playbackProject());
      this.engine.metronome = this.state.metronome;
    }
    await this.engine.resume();
    return this.engine;
  }

  async start(input: InputKind): Promise<void> {
    await this.ensureEngine();
    this.set({ screen: 'instrument', input });
    if (input === 'camera') await this.startCamera();
  }

  async openDemo(input: InputKind): Promise<void> {
    this.loadIntoHistory(demoProject());
    await this.start(input);
    this.toast('Opened “First Light” — press Space to hear it', 'ok');
  }

  async startCamera(): Promise<void> {
    if (!this.tracker) {
      this.tracker = new HandTracker(
        (hands, t) => this.handleHands(hands, t),
        (status) => this.set({ tracker: status }),
      );
    }
    this.set({ input: 'camera' });
    await this.tracker.start();
  }

  stopCamera(): void {
    this.tracker?.stop();
    this.applyGestureCommands(this.gestures.reset());
    this.interpreter.reset();
    this.gestureView = { frame: null, recordHold: 0, degree: null };
    this.set({ input: 'pointer', handsVisible: false });
  }

  get cameraVideo(): HTMLVideoElement | null {
    return this.tracker?.video ?? null;
  }

  get trackerFps(): number {
    return this.tracker?.fps ?? 0;
  }

  // ---------- performing ----------

  noteOn(source: string, degree: number, velocity = 0.8): void {
    const engine = this.engine;
    if (!engine) return;
    const existing = this.state.held.find((h) => h.source === source);
    if (existing) {
      if (existing.degree === degree) return;
      this.noteOff(source);
    }
    const track = this.state.activeTrack;
    const handle = engine.noteOn(track, degree, velocity);
    const playing = engine.isPlaying;
    if (this.recorder && this.recorder.track === track && playing) {
      this.recorder.noteOn(handle.id, degree, velocity, engine.beatAt(handle.startedAt));
    }
    const beat = playing ? engine.loopPositionAt(handle.startedAt) : null;
    this.set({ held: [...this.state.held, { source, track, degree, handle, beat }] });
  }

  noteOff(source: string): void {
    const engine = this.engine;
    const held = this.state.held.find((h) => h.source === source);
    if (!engine || !held) return;
    const t = engine.noteOff(held.handle);
    const remaining = this.state.held.filter((h) => h !== held);
    const note = this.recorder?.noteOff(held.handle.id, engine.beatAt(t)) ?? null;
    this.set(note && this.recorder ? { held: remaining, take: this.recorder.current } : { held: remaining });
  }

  /** Replace a just-started note with a new pitch; the abandoned one is never recorded. */
  retune(source: string, degree: number, velocity = 0.8): void {
    const held = this.state.held.find((h) => h.source === source);
    if (held && this.engine) {
      this.recorder?.cancel(held.handle.id);
      this.engine.noteOff(held.handle);
      this.set({ held: this.state.held.filter((h) => h !== held) });
    }
    this.noteOn(source, degree, velocity);
  }

  releaseAll(): void {
    for (const h of [...this.state.held]) this.noteOff(h.source);
  }

  // ---------- transport & recording ----------

  async togglePlay(): Promise<void> {
    const engine = await this.ensureEngine();
    if (engine.isPlaying) {
      if (this.state.recording) this.stopRecording();
      engine.stop();
      this.set({ playing: false });
    } else {
      await engine.play();
      this.set({ playing: true });
    }
  }

  async toggleRecord(): Promise<void> {
    if (this.state.recording) {
      this.stopRecording();
      return;
    }
    const engine = await this.ensureEngine();
    if (!engine.isPlaying) await engine.play();
    if (this.state.mode === 'sculpt') this.setMode('perform');
    this.recorder = new Recorder(this.project, this.state.activeTrack, this.state.snap);
    this.set({ recording: true, playing: true, take: this.recorder.current });
  }

  private stopRecording(): void {
    const engine = this.engine;
    const rec = this.recorder;
    if (!engine || !rec) return;
    rec.flush(engine.beatAt(engine.ctx.currentTime));
    const take = rec.current;
    this.recorder = null;
    this.set({ recording: false, take: null });
    if (take.notes.length) {
      this.commitProject(addPhrase(this.project, take.phrase, take.notes));
      this.toast(`${THREAD[take.phrase.track].name} phrase ${take.phrase.ordinal} wound · ${take.notes.length} note${take.notes.length === 1 ? '' : 's'}`, 'ok');
    } else {
      this.toast('Recording stopped — no notes were played');
    }
  }

  setMetronome(on: boolean): void {
    if (this.engine) this.engine.metronome = on;
    this.set({ metronome: on });
  }

  setSnap(on: boolean): void {
    this.set({ snap: on });
  }

  setLefty(on: boolean): void {
    this.interpreter.lefty = on;
    this.set({ lefty: on });
  }

  selectTrack(track: TrackId): void {
    if (track === this.state.activeTrack) return;
    if (this.state.recording) this.stopRecording();
    this.releaseAll();
    this.set({ activeTrack: track });
  }

  setMode(mode: Mode): void {
    if (mode === this.state.mode) return;
    if (mode === 'sculpt') {
      if (this.state.recording) this.stopRecording();
      this.releaseAll();
    }
    this.drag = null;
    this.applyGestureCommands(this.gestures.reset());
    this.set({ mode, edit: null, selection: mode === 'perform' ? null : this.state.selection });
  }

  // ---------- project settings ----------

  setBpm(bpm: number): void {
    this.commitProject(updateSettings(this.project, { bpm }));
  }

  setKey(root: number, scale: ScaleName): void {
    this.commitProject(updateSettings(this.project, { root, scale }));
  }

  setName(name: string): void {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed || trimmed === this.project.name) return;
    this.commitProject(updateSettings(this.project, { name: trimmed }));
  }

  setBars(bars: number): void {
    if (bars === this.project.bars) return;
    if (this.state.recording) this.stopRecording();
    const loop = bars * this.project.beatsPerBar;
    const kept = this.project.notes.filter((n) => n.start < loop);
    const removed = this.project.notes.length - kept.length;
    const phrases = this.project.phrases.filter((ph) => kept.some((n) => n.phraseId === ph.id));
    this.commitProject({ ...updateSettings(this.project, { bars }), notes: kept, phrases: phrases.map((ph) => ({ ...ph, anchor: ph.anchor % loop })) });
    if (removed) this.toast(`Loop shortened — ${removed} note${removed === 1 ? '' : 's'} past bar ${bars} removed (⌘Z to undo)`);
  }

  toggleMute(track: TrackId): void {
    this.commitProject(setTrack(this.project, track, { muted: !this.project.tracks[track].muted }));
  }

  undo(): void {
    if (this.drag || this.state.recording) return;
    this.set({ history: undo(this.state.history), edit: null });
    this.pruneSelection();
  }

  redo(): void {
    if (this.drag || this.state.recording) return;
    this.set({ history: redo(this.state.history), edit: null });
    this.pruneSelection();
  }

  get canUndo(): boolean {
    return canUndo(this.state.history);
  }

  get canRedo(): boolean {
    return canRedo(this.state.history);
  }

  private pruneSelection(): void {
    const sel = this.state.selection;
    if (sel && !this.project.phrases.some((p) => p.id === sel)) this.set({ selection: null });
  }

  // ---------- sculpt ----------

  /** Begin a sculpt gesture at a stage point. Returns true if a phrase was grabbed. */
  sculptDown(x: number, y: number): boolean {
    const stage = this.stage;
    if (!stage) return false;
    const project = this.project;
    const note = hitTest(stage.layout, project, x, y, 12);
    if (!note) {
      this.set({ selection: null, edit: null });
      return false;
    }
    const polar = toPolar(stage.layout, x, y, loopBeats(project));
    this.drag = { phraseId: note.phraseId, r0: polar.r, lastTheta: polar.theta, turn: 0, auditionDegree: note.degree };
    this.engine?.audition(note.track, note.degree);
    this.set({ selection: note.phraseId, edit: { phraseId: note.phraseId, steps: 0, beats: 0, factor: 1 } });
    return true;
  }

  sculptMove(x: number, y: number): void {
    const stage = this.stage;
    const drag = this.drag;
    const edit = this.state.edit;
    if (!stage || !drag || !edit) return;
    const project = this.project;
    const loop = loopBeats(project);
    const polar = toPolar(stage.layout, x, y, loop);
    drag.turn += angleDelta(drag.lastTheta, polar.theta);
    drag.lastTheta = polar.theta;
    const beats = quantize((drag.turn / (2 * Math.PI)) * loop, GRID);
    const steps = Math.round((polar.r - drag.r0) / stepSize(stage.layout, project));
    if (steps !== edit.steps) {
      const first = phraseNotes(project, drag.phraseId)[0];
      if (first) this.engine?.audition(first.track, first.degree + steps, 0.18);
    }
    if (steps !== edit.steps || beats !== edit.beats) this.set({ edit: { ...edit, steps, beats } });
  }

  /** Continuous stretch input (pinch spread, wheel); snaps to musical factors. */
  sculptStretch(raw: number): void {
    const edit = this.state.edit;
    if (!edit) return;
    const factor = STRETCH_FACTORS.reduce((best, f) => (Math.abs(Math.log(f / raw)) < Math.abs(Math.log(best / raw)) ? f : best), 1 as number);
    if (factor !== edit.factor) this.set({ edit: { ...edit, factor } });
  }

  sculptUp(): void {
    const edit = this.state.edit;
    this.drag = null;
    if (!edit) return;
    const changed = edit.steps !== 0 || edit.beats !== 0 || edit.factor !== 1;
    const next = changed ? sculptPhrase(this.project, edit.phraseId, edit) : this.project;
    this.set({ edit: null, history: changed ? commit(this.state.history, next) : this.state.history });
  }

  /** Keyboard/button edits on the selected phrase — each is one undo step. */
  nudge(edit: Partial<Omit<SculptEdit, 'phraseId'>>): void {
    const sel = this.state.selection;
    if (!sel || this.drag) return;
    const full = { steps: edit.steps ?? 0, beats: edit.beats ?? 0, factor: edit.factor ?? 1 };
    this.commitProject(sculptPhrase(this.project, sel, full));
    if (full.steps) {
      const first = phraseNotes(this.project, sel)[0];
      if (first) this.engine?.audition(first.track, first.degree, 0.18);
    }
  }

  selectPhrase(id: string | null): void {
    this.set({ selection: id });
  }

  deleteSelected(): void {
    const sel = this.state.selection;
    if (!sel) return;
    this.commitProject(deletePhrase(this.project, sel));
    this.set({ selection: null });
    this.toast('Phrase removed (⌘Z to undo)');
  }

  // ---------- gestures ----------

  /** Entry point for real tracker frames and synthetic test fixtures alike. */
  handleHands(raw: RawHand[], tMs: number): void {
    const frame = this.interpreter.process(raw, tMs);
    const out = this.gestures.update(frame, this.state.mode, pitchRange(this.project));
    this.gestureView = { frame, recordHold: out.recordHold, degree: out.degree };
    if (frame.hands.length) this.lastHandsAt = tMs;
    const visible = frame.hands.length > 0 || tMs - this.lastHandsAt < 400;
    if (visible !== this.state.handsVisible) this.set({ handsVisible: visible });
    this.applyGestureCommands(out.commands);
  }

  private stagePoint(nx: number, ny: number): { x: number; y: number } | null {
    const s = this.stage;
    if (!s) return null;
    // The central 80% of the camera frame spans the whole spool.
    const map = (v: number) => ((v - 0.1) / 0.8) * s.size;
    return { x: map(nx), y: map(ny) };
  }

  private applyGestureCommands(commands: GestureCommand[]): void {
    for (const c of commands) {
      switch (c.type) {
        case 'noteOn':
        case 'glide':
          this.noteOn('gesture', c.degree, c.velocity);
          break;
        case 'retune':
          this.retune('gesture', c.degree, c.velocity);
          break;
        case 'noteOff':
          this.noteOff('gesture');
          break;
        case 'toggleRecord':
          void this.toggleRecord();
          break;
        case 'grab': {
          const p = this.stagePoint(c.x, c.y);
          if (p) this.sculptDown(p.x, p.y);
          break;
        }
        case 'drag': {
          const p = this.stagePoint(c.x, c.y);
          if (p) this.sculptMove(p.x, p.y);
          break;
        }
        case 'stretch':
          this.sculptStretch(c.factor);
          break;
        case 'drop':
          this.sculptUp();
          break;
      }
    }
  }

  /** Where the play hand points on the stage (sculpt cursor). */
  handStagePoint(): { x: number; y: number; pinched: boolean } | null {
    const play = this.gestureView.frame?.play;
    if (!play) return null;
    const p = this.stagePoint(play.x, play.y);
    return p ? { ...p, pinched: play.pinched } : null;
  }

  // ---------- persistence & export ----------

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = null;
      try {
        saveProject(this.project);
        this.set({ saved: listProjects(), lastSavedAt: Date.now() });
      } catch {
        /* explicit save reports storage errors */
      }
    }, AUTOSAVE_MS);
  }

  save(): void {
    try {
      saveProject(this.project);
      this.set({ saved: listProjects(), lastSavedAt: Date.now() });
      this.toast(`Saved “${this.project.name}” in this browser · ${this.project.notes.length} notes`, 'ok');
    } catch (err) {
      this.toast(err instanceof StorageError ? err.message : 'Saving failed.', 'error');
    }
  }

  private loadIntoHistory(project: Project): void {
    if (this.state.recording) this.stopRecording();
    this.releaseAll();
    this.drag = null;
    setLastOpened(project.id);
    this.set({ history: createHistory(project), selection: null, edit: null });
  }

  open(id: string): void {
    try {
      this.loadIntoHistory(loadProject(id));
      this.toast(`Opened “${this.project.name}”`, 'ok');
    } catch (err) {
      this.toast(err instanceof Error ? err.message : 'Could not open that project.', 'error');
    }
  }

  newProject(): void {
    this.save();
    const fresh = createProject({ bpm: this.project.bpm, root: this.project.root, scale: this.project.scale });
    this.loadIntoHistory(fresh);
    saveProject(fresh);
    this.set({ saved: listProjects() });
  }

  async exportWav(): Promise<ExportReport | null> {
    if (this.state.busy) return null;
    this.set({ busy: 'export' });
    try {
      const { blob, report } = await renderWav(this.project);
      download(blob, report.fileName);
      this.set({ busy: null, lastExport: report });
      this.toast(`Exported ${report.fileName} · ${report.seconds.toFixed(1)} s · ${(report.sampleRate / 1000).toFixed(1)} kHz stereo · peak ${report.peakDb.toFixed(1)} dB`, 'ok');
      return report;
    } catch (err) {
      this.set({ busy: null });
      this.toast(err instanceof Error ? err.message : 'Export failed.', 'error');
      return null;
    }
  }

  exportJson(): void {
    download(projectToJson(this.project), `${safeFileName(this.project.name)}.spool.json`);
  }

  async importJson(file: File): Promise<void> {
    try {
      const project = await projectFromFile(file);
      this.loadIntoHistory(project);
      saveProject(project);
      this.set({ saved: listProjects() });
      this.toast(`Imported “${project.name}”`, 'ok');
    } catch (err) {
      this.toast(err instanceof Error ? err.message : 'Import failed.', 'error');
    }
  }

  /** Visual helper: radius of a degree in the active ring (for rail ↔ ring alignment). */
  degreeRadius(track: TrackId, degree: number): number | null {
    return this.stage ? degreeRadius(this.stage.layout, this.project, track, degree) : null;
  }
}
