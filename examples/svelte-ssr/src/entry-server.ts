import { render as renderApp } from 'svelte/server';
import App from './App.svelte';

/** The app's HTML, to put in place of `<!--app-->` in the built `index.html`. */
export function render(): string {
  return renderApp(App).body;
}
