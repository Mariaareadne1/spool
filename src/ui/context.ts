import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AppState, SpoolApp } from '../state/app';

export const AppContext = createContext<SpoolApp | null>(null);

export function useSpool(): SpoolApp {
  const app = useContext(AppContext);
  if (!app) throw new Error('useSpool must be used inside <AppContext.Provider>');
  return app;
}

export function useAppState(): AppState {
  const app = useSpool();
  return useSyncExternalStore(app.subscribe, app.getSnapshot);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
}
