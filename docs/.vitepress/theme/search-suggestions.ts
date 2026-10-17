/**
 * Suggestions for the local search box while its query is empty: popular
 * pages to open and a few searches to run. The search box has no slot for
 * this, so a small panel is added to it whenever it opens.
 */
import { withBase } from 'vitepress';

const PAGES: [string, string][] = [
  ['Getting started', '/guide/getting-started'],
  ['Series and data', '/guide/series'],
  ['Data sources', '/guide/data-sources'],
  ['Indicators', '/guide/indicators'],
  ['Drawings', '/guide/drawings'],
  ['Theming', '/guide/theming'],
  ['Performance', '/guide/performance'],
  ['Playground', '/playground'],
];

const SEARCHES = ['candles', 'heatmap', 'depth lane', 'volume profile', 'footprint', 'testing'];

const ARROW =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';

function buildPanel(input: HTMLInputElement): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'search-suggestions';
  panel.innerHTML = `
    <p class="search-suggestions-title">Popular pages</p>
    <ul class="search-suggestions-pages">${PAGES.map(
      ([title, path]) => `<li><a href="${withBase(path)}">${title}${ARROW}</a></li>`,
    ).join('')}</ul>
    <p class="search-suggestions-title">Try searching</p>
    <div class="search-suggestions-terms">${SEARCHES.map(
      (term) => `<button type="button" data-term="${term}">${term}</button>`,
    ).join('')}</div>`;
  panel.addEventListener('click', (event) => {
    const target = event.target as Element;
    const term = target.closest<HTMLElement>('[data-term]')?.dataset.term;
    if (term) {
      // The search box reads its query from the input event.
      input.value = term;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    } else if (target.closest('a')) {
      // The page opens through the router; the box closes like it does on Escape.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
  });
  return panel;
}

/** Adds the suggestions to every search box that opens. Browser only. */
export function installSearchSuggestions(): void {
  new MutationObserver(() => {
    const box = document.querySelector('.VPLocalSearchBox');
    const input = box?.querySelector<HTMLInputElement>('.search-input');
    const results = box?.querySelector('.results');
    if (!input || !results || box!.querySelector('.search-suggestions')) return;
    const panel = buildPanel(input);
    const sync = () => (panel.hidden = input.value.trim() !== '');
    input.addEventListener('input', sync);
    // The reset button clears the query without an input event.
    box!.querySelector('.clear-button')?.addEventListener('click', () => setTimeout(sync));
    sync();
    results.after(panel);
  }).observe(document.body, { childList: true });
}
