import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './App';

/** The app's HTML, to put in place of `<!--app-->` in the built `index.html`. */
export function render(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
