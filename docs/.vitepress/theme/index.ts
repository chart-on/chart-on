import { defineAsyncComponent, h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import { inBrowser, type Theme } from 'vitepress';
import Example from './Example.vue';
import MarkdownLink from './MarkdownLink.vue';
import Landing from './site/Landing.vue';
import { installSearchSuggestions } from './search-suggestions';
import './custom.css';
import './site/site.css';

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'doc-footer-before': () => h(MarkdownLink) }),
  enhanceApp({ app }) {
    if (inBrowser) installSearchSuggestions();
    app.component('Example', Example);
    app.component('Landing', Landing);
    // Async, so only the playground page downloads it and the compiler it loads.
    app.component('Playground', defineAsyncComponent(() => import('./Playground.vue')));
    app.component('ThemeBuilder', defineAsyncComponent(() => import('./ThemeBuilder.vue')));
    // Async, so only the preview page downloads the shell and the exchange library.
    app.component('Preview', defineAsyncComponent(() => import('./Preview.vue')));
  },
} satisfies Theme;
