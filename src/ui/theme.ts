import type { TrackId } from '../music/types';

/** Canvas colours. Mirrors the CSS custom properties in styles/tokens.css. */
export const INK = {
  bg: '#0d0c0a',
  paper: '#ede6da',
  muted: '#9a9183',
  faint: '#5f584e',
  hair: 'rgba(237, 230, 218, 0.07)',
  hairStrong: 'rgba(237, 230, 218, 0.14)',
  rec: '#ff5a4e',
} as const;

export const THREAD: Record<TrackId, { readonly color: string; readonly rgb: string; readonly name: string; readonly roman: string; readonly blurb: string }> = {
  glass: { color: '#ecd6a0', rgb: '236, 214, 160', name: 'Glass', roman: 'I', blurb: 'FM bell · high' },
  pluck: { color: '#e8745c', rgb: '232, 116, 92', name: 'Pluck', roman: 'II', blurb: 'filtered saw · melody' },
  pad: { color: '#7fbaa6', rgb: '127, 186, 166', name: 'Pad', roman: 'III', blurb: 'triads · slow swell' },
  bass: { color: '#9592e0', rgb: '149, 146, 224', name: 'Bass', roman: 'IV', blurb: 'sine + edge · low' },
};

export const FONT = {
  display: '"Fraunces Variable", "Iowan Old Style", Georgia, serif',
  ui: '"Inter Tight Variable", "Helvetica Neue", Arial, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
} as const;
