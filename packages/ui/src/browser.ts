/**
 * Entry of the script-tag build: the engine and the shell in one file, for
 * pages without a bundler. `dist/browser/charton.js` is an ES module and
 * `dist/browser/charton.iife.js` a classic script that defines the global
 * `charton`, with the opt-in add-ons (`@chart-on/ui/templates`) included. Bundled
 * apps import `@chart-on/core`, `@chart-on/ui` and its add-on entries instead.
 */
// Named here as well, so the stylesheet is emitted next to the bundle as `style.css`.
import './style.css';

export * from '@chart-on/core';
export * from './index';
export * from './templates';
