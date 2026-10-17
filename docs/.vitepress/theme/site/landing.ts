import { mountAppearance } from './appearance';
import { mountCustomize } from './customize';
import { mountOrderFlow } from './order-flow';
import { mountSpeedDemo } from './speed-demo';
import type { Section } from './section';
import { slidingIndicator } from './slide';

/**
 * Brings the server-rendered landing markup to life: charts, snippet tabs, the
 * copy button and the footer scheme picker, which calls `setSiteDark`.
 */
export function mountLanding(root: HTMLElement, dark: boolean, setSiteDark: (dark: boolean) => void): Section {
  const sections = [mountSpeedDemo, mountOrderFlow, mountCustomize].map((mount) => mount(root, dark));

  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-snippet]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[data-snippet-panel]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
      for (const p of panels) p.hidden = p.dataset.snippetPanel !== tab.dataset.snippet;
    });
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', async () => {
      const done = button.querySelector('.lp-install-done')!;
      try {
        await navigator.clipboard.writeText(button.dataset.copy!);
        done.textContent = 'Copied';
      } catch {
        done.textContent = 'Copy failed';
      }
      setTimeout(() => (done.textContent = ''), 1500);
    });
  }

  const removeSlide = slidingIndicator(root.querySelector<HTMLElement>('.lp-editor-tabs')!);
  const removeAppearance = mountAppearance(root.querySelector<HTMLElement>('.lp-appearance')!, setSiteDark);
  const removeNavHiding = hideNavOnScroll();
  // The hero's moving packets are SVG animations, which CSS cannot stop.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) root.querySelector<SVGSVGElement>('.lp-hero-art')?.pauseAnimations();

  return {
    setDark(value) {
      sections.forEach((s) => s.setDark(value));
    },
    destroy() {
      removeSlide();
      removeAppearance();
      removeNavHiding();
      sections.forEach((s) => s.destroy());
    },
  };
}

/** Scroll moves smaller than this (css px) leave the nav as it is. */
const NAV_JITTER = 4;

/**
 * Slides the docs nav away while the reader scrolls down and brings it back on
 * any scroll up. It stays near the top of the page, while the menu screen is
 * open, and while it holds focus. Returns a function that removes it.
 */
function hideNavOnScroll(): () => void {
  const nav = document.querySelector<HTMLElement>('.VPNav');
  if (!nav) return () => {};
  let last = scrollY;
  const onScroll = () => {
    const y = scrollY;
    if (Math.abs(y - last) < NAV_JITTER) return;
    const keep = y < 80 || nav.contains(document.activeElement) || !!document.querySelector('.VPNavScreen');
    nav.classList.toggle('lp-nav-hidden', !keep && y > last);
    last = y;
  };
  const show = () => nav.classList.remove('lp-nav-hidden');
  addEventListener('scroll', onScroll, { passive: true });
  nav.addEventListener('focusin', show);
  return () => {
    removeEventListener('scroll', onScroll);
    nav.removeEventListener('focusin', show);
    show();
  };
}

