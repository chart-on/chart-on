import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { App } from './App';

// Attach to the server's markup instead of rendering it again.
hydrateRoot(
  document.getElementById('root')!,
  <StrictMode>
    <App />
  </StrictMode>,
);
