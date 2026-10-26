import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/inter-tight';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './ui/App';
import { AppContext } from './ui/context';
import { SpoolApp } from './state/app';
import { installTestHooks } from './state/testHooks';

const app = new SpoolApp();
installTestHooks(app);

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <AppContext.Provider value={app}>
      <App />
    </AppContext.Provider>
  </StrictMode>,
);
