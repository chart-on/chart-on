/**
 * Entry of the script-tag build: the engine and the shell in one file, for
 * pages without a bundler. `dist/browser/charton.js` is an ES module and
 * `dist/browser/charton.iife.js` a classic script that defines the global
 * `charton`, with the opt-in add-ons (`@charton/ui/templates`) included. Bundled
 * apps import `@charton/core`, `@charton/ui` and its add-on entries instead.
 */
// Named here as well, so the stylesheet is emitted next to the bundle as `style.css`.
import './style.css';

export * from '@charton/core';
export * from './index';
export * from './templates';
