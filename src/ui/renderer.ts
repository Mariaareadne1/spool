import { chordDegrees, NOTE_NAMES, SCALES, SCALE_LABELS, mod } from '../music/theory';
import { VOICES } from '../audio/voices';
import { loopBeats, type Note, type Project, type TrackId } from '../music/types';
import type { HeldNote, Mode, SculptEdit } from '../state/app';
import { beatAngle, degreeRadius, layoutFor, pitchRange, RING_ORDER, ringBounds, stepSize, type Layout } from './geometry';
import { FONT, INK, THREAD } from './theme';

export interface SceneStatic {
  readonly project: Project;
  /** The committed project — drawn as a ghost under a live sculpt preview. */
  readonly base: Project;
  readonly activeTrack: TrackId;
  readonly mode: Mode;
  readonly selection: string | null;
  readonly hover: string | null;
  readonly edit: SculptEdit | null;
  readonly recording: boolean;
}

export interface SceneDynamic {
  readonly position: number | null;
  readonly held: readonly HeldNote[];
  readonly cursor: { x: number; y: number; pinched: boolean } | null;
  readonly reducedMotion: boolean;
  readonly now: number;
}

const TAU = Math.PI * 2;

/** Arc span of a note, trimmed so consecutive notes read as separate threads (round caps overhang). */
function noteAngles(n: Pick<Note, 'start' | 'duration'>, loop: number, r: number, w: number): [number, number] {
  const a0 = beatAngle(n.start, loop);
  const a1 = beatAngle(n.start + n.duration, loop);
  const trim = Math.min((a1 - a0) * 0.35, (w * 0.5 + 2.5) / Math.max(1, r));
  return [a0 + trim, a1 - trim];
}

function noteWidth(l: Layout, project: Project, note: Pick<Note, 'velocity'>): number {
  return Math.max(2.5, stepSize(l, project) * (0.62 + 0.36 * note.velocity));
}

/**
 * Draws a thread: soft halo, solid core, and a thin inner highlight that
 * reads as sheen on a wound fibre. Arcs past 2π simply keep winding.
 */
function drawThread(
  g: CanvasRenderingContext2D, l: Layout, r: number, a0: number, a1: number, width: number, rgb: string, alpha: number,
): void {
  g.lineCap = 'round';
  g.beginPath();
  g.arc(l.cx, l.cy, r, a0, a1);
  g.strokeStyle = `rgba(${rgb}, ${alpha * 0.18})`;
  g.lineWidth = width * 2.4;
  g.stroke();
  g.beginPath();
  g.arc(l.cx, l.cy, r, a0, a1);
  g.strokeStyle = `rgba(${rgb}, ${alpha})`;
  g.lineWidth = width;
  g.stroke();
  if (width > 3) {
    g.beginPath();
    g.arc(l.cx, l.cy, r - width * 0.22, a0, a1);
    g.strokeStyle = `rgba(255, 250, 240, ${alpha * 0.22})`;
    g.lineWidth = Math.max(0.6, width * 0.16);
    g.stroke();
  }
}

export class SpoolRenderer {
  private staticCanvas = document.createElement('canvas');
  private staticKey: unknown[] = [];
  private size = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {}

  resize(size: number, dpr: number): void {
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    for (const c of [this.canvas, this.staticCanvas]) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.staticKey = [];
  }

  get layout(): Layout {
    return layoutFor(this.size);
  }

  draw(s: SceneStatic, d: SceneDynamic): void {
    if (this.size === 0) return;
    const key = [s.project, s.base, s.activeTrack, s.mode, s.selection, s.hover, s.edit, s.recording, this.size, this.dpr];
    if (key.some((k, i) => k !== this.staticKey[i])) {
      this.drawStatic(s);
      this.staticKey = key;
    }
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.staticCanvas, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawDynamic(g, s, d);
  }

  // ---------------- static layer ----------------

  private drawStatic(s: SceneStatic): void {
    const g = this.staticCanvas.getContext('2d');
    if (!g) return;
    const l = this.layout;
    const p = s.project;
    const loop = loopBeats(p);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.staticCanvas.width, this.staticCanvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawRings(g, l, s);
    this.drawTicks(g, l, loop, p.beatsPerBar);

    // Notes
    const sculpting = s.mode === 'sculpt';
    if (s.edit) {
      // ghost of the phrase where it was, before this drag
      for (const n of s.base.notes) {
        if (n.phraseId !== s.edit.phraseId) continue;
        const r = degreeRadius(l, s.base, n.track, n.degree);
        g.setLineDash([2, 4]);
        g.lineCap = 'butt';
        g.beginPath();
        g.arc(l.cx, l.cy, r, beatAngle(n.start, loop), beatAngle(n.start + n.duration, loop));
        g.strokeStyle = `rgba(${THREAD[n.track].rgb}, 0.35)`;
        g.lineWidth = 1.2;
        g.stroke();
        g.setLineDash([]);
      }
    }
    const ordered = [...p.notes].sort((a, b) => Number(a.phraseId === s.selection) - Number(b.phraseId === s.selection));
    for (const n of ordered) {
      const t = THREAD[n.track];
      const selected = n.phraseId === s.selection;
      const hovered = n.phraseId === s.hover;
      const muted = p.tracks[n.track].muted;
      let alpha = muted ? 0.22 : 0.88;
      if (sculpting && s.selection && !selected) alpha *= 0.38;
      if (sculpting && hovered && !selected) alpha = Math.min(1, alpha + 0.25);
      const r = degreeRadius(l, p, n.track, n.degree);
      const w = noteWidth(l, p, n);
      const [a0, a1] = noteAngles(n, loop, r, w);
      drawThread(g, l, r, a0, a1, w, t.rgb, alpha);
      if (VOICES[n.track].chord) {
        // a chord is three strands: the upper chord tones ride above the root
        for (const d of chordDegrees(n.degree).slice(1)) {
          drawThread(g, l, degreeRadius(l, p, n.track, d), a0, a1, w * 0.45, t.rgb, alpha * 0.7);
        }
      }
      if (selected && sculpting) {
        g.lineCap = 'round';
        g.beginPath();
        g.arc(l.cx, l.cy, r, a0, a1);
        g.strokeStyle = 'rgba(255, 250, 240, 0.9)';
        g.lineWidth = 1;
        g.setLineDash([]);
        g.stroke();
      }
    }
    if (sculpting && s.selection) this.drawPhraseThread(g, l, p, s.selection);
    this.drawHub(g, l, p, s.recording);
  }

  private drawRings(g: CanvasRenderingContext2D, l: Layout, s: SceneStatic): void {
    const p = s.project;
    const { lo, hi } = pitchRange(p);
    const octave = SCALES[p.scale].length;
    // warm depth: light pooling at the centre of the spool
    const glow = g.createRadialGradient(l.cx, l.cy, l.hub * 0.5, l.cx, l.cy, l.outer);
    glow.addColorStop(0, 'rgba(236, 214, 160, 0.06)');
    glow.addColorStop(0.6, 'rgba(236, 214, 160, 0.018)');
    glow.addColorStop(1, 'rgba(236, 214, 160, 0)');
    g.fillStyle = glow;
    g.fillRect(l.cx - l.outer, l.cy - l.outer, l.outer * 2, l.outer * 2);
    for (const track of RING_ORDER) {
      const { inner, outer } = ringBounds(l, track);
      const t = THREAD[track];
      const active = track === s.activeTrack && s.mode === 'perform';
      // one faint lane per degree: the empty spool already shows where pitches go
      for (let d = lo; d <= hi; d++) {
        g.beginPath();
        g.arc(l.cx, l.cy, degreeRadius(l, p, track, d), 0, TAU);
        g.strokeStyle = active ? `rgba(${t.rgb}, 0.06)` : 'rgba(237, 230, 218, 0.022)';
        g.lineWidth = 0.6;
        g.stroke();
      }
      if (active) {
        g.beginPath();
        g.arc(l.cx, l.cy, outer - 1, 0, TAU);
        g.arc(l.cx, l.cy, inner + 1, 0, TAU, true);
        g.fillStyle = `rgba(${t.rgb}, 0.045)`;
        g.fill();
      }
      // tonic circles: the "staff lines" of each ring
      for (let d = lo; d <= hi; d += octave) {
        g.beginPath();
        g.arc(l.cx, l.cy, degreeRadius(l, p, track, d), 0, TAU);
        g.strokeStyle = active ? `rgba(${t.rgb}, 0.22)` : INK.hair;
        g.lineWidth = 0.75;
        g.stroke();
      }
      // ring label just left of the seam
      const labelR = (inner + outer) / 2;
      const a = -Math.PI / 2 - 0.035;
      g.save();
      g.translate(l.cx + Math.cos(a) * labelR, l.cy + Math.sin(a) * labelR);
      g.fillStyle = active ? t.color : INK.faint;
      g.font = `500 ${Math.max(8, l.outer * 0.026)}px ${FONT.mono}`;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillText(t.roman, 0, 0);
      g.restore();
    }
    // seam: beat one
    g.beginPath();
    g.moveTo(l.cx, l.cy - l.hub);
    g.lineTo(l.cx, l.cy - l.outer * 0.9);
    g.strokeStyle = INK.hairStrong;
    g.lineWidth = 0.75;
    g.stroke();
  }

  private drawTicks(g: CanvasRenderingContext2D, l: Layout, loop: number, beatsPerBar: number): void {
    const r0 = l.outer * 0.9;
    for (let i = 0; i < loop * 4; i++) {
      const beat = i / 4;
      const a = beatAngle(beat, loop);
      const isBar = i % (beatsPerBar * 4) === 0;
      const isBeat = i % 4 === 0;
      const len = isBar ? l.outer * 0.055 : isBeat ? l.outer * 0.03 : l.outer * 0.012;
      g.beginPath();
      g.moveTo(l.cx + Math.cos(a) * r0, l.cy + Math.sin(a) * r0);
      g.lineTo(l.cx + Math.cos(a) * (r0 + len), l.cy + Math.sin(a) * (r0 + len));
      g.strokeStyle = isBar ? 'rgba(237, 230, 218, 0.55)' : isBeat ? 'rgba(237, 230, 218, 0.28)' : 'rgba(237, 230, 218, 0.12)';
      g.lineWidth = isBar ? 1.2 : 0.8;
      g.stroke();
      if (isBar) {
        const bar = i / (beatsPerBar * 4) + 1;
        const lr = l.outer * 0.995;
        const la = a + 0.06;
        g.save();
        g.translate(l.cx + Math.cos(la) * lr, l.cy + Math.sin(la) * lr);
        g.fillStyle = INK.muted;
        g.font = `italic 400 ${Math.max(10, l.outer * 0.042)}px ${FONT.display}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(bar), 0, 0);
        g.restore();
      }
    }
    g.beginPath();
    g.arc(l.cx, l.cy, r0, 0, TAU);
    g.strokeStyle = INK.hair;
    g.lineWidth = 0.75;
    g.stroke();
  }

  /** Hairline joining the selected phrase's notes in time order, with an anchor mark. */
  private drawPhraseThread(g: CanvasRenderingContext2D, l: Layout, p: Project, phraseId: string): void {
    const loop = loopBeats(p);
    const phrase = p.phrases.find((ph) => ph.id === phraseId);
    if (!phrase) return;
    const notes = p.notes.filter((n) => n.phraseId === phraseId).sort((a, b) => mod(a.start - phrase.anchor, loop) - mod(b.start - phrase.anchor, loop));
    g.beginPath();
    notes.forEach((n, i) => {
      const r = degreeRadius(l, p, n.track, n.degree);
      const a = beatAngle(n.start, loop);
      const x = l.cx + Math.cos(a) * r;
      const y = l.cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.strokeStyle = 'rgba(255, 250, 240, 0.35)';
    g.lineWidth = 0.75;
    g.stroke();
    const a = beatAngle(phrase.anchor, loop);
    const r = l.outer * 0.88;
    g.save();
    g.translate(l.cx + Math.cos(a) * r, l.cy + Math.sin(a) * r);
    g.rotate(a + Math.PI / 4);
    g.fillStyle = THREAD[phrase.track].color;
    g.fillRect(-3, -3, 6, 6);
    g.restore();
  }

  private drawHub(g: CanvasRenderingContext2D, l: Layout, p: Project, recording: boolean): void {
    g.beginPath();
    g.arc(l.cx, l.cy, l.hub, 0, TAU);
    g.fillStyle = 'rgba(237, 230, 218, 0.025)';
    g.fill();
    g.strokeStyle = recording ? 'rgba(255, 90, 78, 0.7)' : INK.hairStrong;
    g.lineWidth = recording ? 1.5 : 0.75;
    g.stroke();
    const name = NOTE_NAMES[p.root];
    g.fillStyle = INK.paper;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = `italic 300 ${l.hub * 0.62}px ${FONT.display}`;
    g.fillText(name, l.cx, l.cy + l.hub * 0.1);
    g.fillStyle = INK.muted;
    g.font = `400 ${Math.max(9, l.hub * 0.15)}px ${FONT.ui}`;
    g.fillText(SCALE_LABELS[p.scale], l.cx, l.cy + l.hub * 0.38);
    g.fillStyle = recording ? INK.rec : INK.faint;
    g.font = `500 ${Math.max(8, l.hub * 0.12)}px ${FONT.mono}`;
    g.fillText(recording ? '● REC' : `${p.bpm} BPM`, l.cx, l.cy + l.hub * 0.6);
  }

  // ---------------- dynamic layer ----------------

  private drawDynamic(g: CanvasRenderingContext2D, s: SceneStatic, d: SceneDynamic): void {
    const l = this.layout;
    const p = s.project;
    const loop = loopBeats(p);
    const pos = d.position;

    if (pos !== null) {
      const a = beatAngle(pos, loop);
      this.drawSweep(g, l, a, s.recording, d.reducedMotion);
      // sounding notes glow and carry a spark at the playhead
      for (const n of p.notes) {
        if (p.tracks[n.track].muted) continue;
        const rel = mod(pos - n.start, loop);
        if (rel > n.duration) continue;
        const t = THREAD[n.track];
        const r = degreeRadius(l, p, n.track, n.degree);
        const fade = 1 - rel / n.duration;
        g.save();
        g.shadowColor = t.color;
        g.shadowBlur = 14;
        const [a0] = noteAngles(n, loop, r, noteWidth(l, p, n));
        drawThread(g, l, r, a0, Math.max(a0, a), noteWidth(l, p, n) * 1.15, t.rgb, 0.55 + 0.45 * fade);
        g.restore();
        g.beginPath();
        g.arc(l.cx + Math.cos(a) * r, l.cy + Math.sin(a) * r, noteWidth(l, p, n) * 0.75, 0, TAU);
        g.fillStyle = 'rgba(255, 250, 240, 0.95)';
        g.fill();
      }
    }

    for (const h of d.held) this.drawHeld(g, l, p, h, pos, loop, d);
    if (d.cursor) this.drawCursor(g, d.cursor, d.now, d.reducedMotion);
  }

  private drawSweep(g: CanvasRenderingContext2D, l: Layout, a: number, recording: boolean, reduced: boolean): void {
    const rgb = recording ? '255, 90, 78' : '255, 246, 230';
    const trail = reduced ? 0.12 : 0.55;
    if (typeof g.createConicGradient === 'function') {
      const grad = g.createConicGradient(a - trail, l.cx, l.cy);
      grad.addColorStop(0, `rgba(${rgb}, 0)`);
      grad.addColorStop(trail / TAU, `rgba(${rgb}, ${recording ? 0.11 : 0.07})`);
      grad.addColorStop(trail / TAU + 0.0001, `rgba(${rgb}, 0)`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      g.beginPath();
      g.arc(l.cx, l.cy, l.outer * 0.9, a - trail, a);
      g.arc(l.cx, l.cy, l.hub, a, a - trail, true);
      g.closePath();
      g.fillStyle = grad;
      g.fill();
    }
    g.beginPath();
    g.moveTo(l.cx + Math.cos(a) * l.hub, l.cy + Math.sin(a) * l.hub);
    g.lineTo(l.cx + Math.cos(a) * l.outer * 0.96, l.cy + Math.sin(a) * l.outer * 0.96);
    g.strokeStyle = `rgba(${rgb}, 0.85)`;
    g.lineWidth = 1.25;
    g.stroke();
    g.beginPath();
    g.arc(l.cx + Math.cos(a) * l.outer * 0.96, l.cy + Math.sin(a) * l.outer * 0.96, 2.5, 0, TAU);
    g.fillStyle = `rgba(${rgb}, 1)`;
    g.fill();
  }

  private drawHeld(g: CanvasRenderingContext2D, l: Layout, p: Project, h: HeldNote, pos: number | null, loop: number, d: SceneDynamic): void {
    const t = THREAD[h.track];
    const r = degreeRadius(l, p, h.track, h.degree);
    const w = noteWidth(l, p, { velocity: 0.9 });
    const pulse = d.reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(d.now / 90);
    if (pos !== null && h.beat !== null) {
      const span = mod(pos - h.beat, loop);
      g.save();
      g.shadowColor = t.color;
      g.shadowBlur = 18;
      drawThread(g, l, r, beatAngle(h.beat, loop), beatAngle(h.beat + span, loop), w * 1.2, t.rgb, pulse);
      g.restore();
    } else {
      // transport stopped: the whole string at this pitch vibrates
      g.beginPath();
      g.arc(l.cx, l.cy, r, 0, TAU);
      g.strokeStyle = `rgba(${t.rgb}, ${0.55 * pulse})`;
      g.lineWidth = w * 0.6;
      g.save();
      g.shadowColor = t.color;
      g.shadowBlur = 16;
      g.stroke();
      g.restore();
    }
  }

  private drawCursor(g: CanvasRenderingContext2D, c: { x: number; y: number; pinched: boolean }, now: number, reduced: boolean): void {
    const r = c.pinched ? 7 : 13 + (reduced ? 0 : Math.sin(now / 240) * 1.5);
    g.beginPath();
    g.arc(c.x, c.y, r, 0, TAU);
    g.strokeStyle = 'rgba(255, 250, 240, 0.9)';
    g.lineWidth = 1.5;
    g.stroke();
    if (c.pinched) {
      g.fillStyle = 'rgba(255, 250, 240, 0.85)';
      g.fill();
    }
  }
}
