import { slidingIndicator } from './slide';

/** The colour scheme choices. Until the reader picks one, the page follows the system. */
export const APPEARANCES: ['light' | 'dark', string, string][] = [
  [
    'light',
    'Light',
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/></svg>',
  ],
  ['dark', 'Dark', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/></svg>'],
];

const KEY = 'vitepress-theme-appearance';
// Tells every picker on the page (nav and footer) to show the new choice.
const CHANGED = 'site-appearance';

/**
 * Brings a scheme picker (`[data-appearance]` radios) to life. The checked
 * button is the scheme on screen, so with no choice yet it follows the system.
 * VitePress stores 'auto' whenever the choice matches the system, so the
 * explicit choice is written to its storage key once VitePress has written its
 * own. Returns a function that removes it.
 */
export function mountAppearance(group: HTMLElement, setDark: (dark: boolean) => void): () => void {
  const show = () => {
    const mode = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    for (const p of group.querySelectorAll<HTMLElement>('[data-appearance]')) {
      p.setAttribute('aria-checked', String(p.dataset.appearance === mode));
    }
  };
  // VitePress follows a system change while nothing is picked; show it once applied.
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const onSystem = () => setTimeout(show);
  const pick = (event: Event) => {
    const mode = (event.target as Element).closest<HTMLElement>('[data-appearance]')?.dataset.appearance;
    if (!mode) return;
    setDark(mode === 'dark');
    // VitePress writes its own value in its next update, after this handler.
    setTimeout(() => {
      try {
        localStorage.setItem(KEY, mode);
      } catch {
        // Storage blocked: the choice lasts until the page reloads.
      }
      dispatchEvent(new Event(CHANGED));
    });
  };

  show();
  const removeSlide = slidingIndicator(group);
  group.addEventListener('click', pick);
  addEventListener(CHANGED, show);
  systemDark.addEventListener('change', onSystem);
  return () => {
    removeSlide();
    group.removeEventListener('click', pick);
    removeEventListener(CHANGED, show);
    systemDark.removeEventListener('change', onSystem);
  };
}
