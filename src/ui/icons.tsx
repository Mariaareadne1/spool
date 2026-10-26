const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const PlayIcon = () => (
  <svg {...base} fill="currentColor" stroke="none"><path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" /></svg>
);
export const StopIcon = () => (
  <svg {...base} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
);
export const UndoIcon = () => (
  <svg {...base}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
);
export const RedoIcon = () => (
  <svg {...base}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
);
export const CameraIcon = () => (
  <svg {...base}><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.3l1.4-2h7.6l1.4 2h2.3A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const DownloadIcon = () => (
  <svg {...base}><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>
);
export const TrashIcon = () => (
  <svg {...base}><path d="M5 7h14" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 12a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4L18 7" /><path d="M9 7V4.5h6V7" /></svg>
);
export const HandIcon = () => (
  <svg {...base}><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5" /><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14" /><path d="M8 12.5 6.6 11a1.6 1.6 0 0 0-2.4 2.1L8 18.5a6 6 0 0 0 4.8 2.5H13a4 4 0 0 0 4-4v-3" /></svg>
);
export const ChevronIcon = () => (
  <svg {...base}><path d="m7 10 5 5 5-5" /></svg>
);
