import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { App } from './App';

/** The app's HTML, to put in place of `<!--app-->` in the built `index.html`. */
export function render(): Promise<string> {
  return renderToString(createSSRApp(App));
}
