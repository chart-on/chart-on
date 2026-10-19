/**
 * Eased wheel scrolling for the site pages. Touch scrolling stays native, and
 * readers who prefer reduced motion keep native scrolling everywhere.
 */
import type { Router } from 'vitepress';

export async function installSmoothScroll(router: Router): Promise<void> {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const { default: Lenis } = await import('lenis');
  const lenis = new Lenis({
    autoRaf: true,
    // Sidebar, outline, menus and code panes scroll themselves until they reach an end.
    allowNestedScroll: true,
    // A chart that zooms or pans on the wheel cancels the event, and a scroll lock
    // (search box, mobile menu) hides the body overflow: leave both alone.
    virtualScroll: ({ event }) => !event.defaultPrevented && document.body.style.overflow !== 'hidden',
  });
  // The router jumps to the top or to a hash on navigation; drop any eased scroll
  // in flight. Stopping and starting both reset it, in one task, so the stopped
  // state never paints.
  const before = router.onBeforeRouteChange;
  router.onBeforeRouteChange = (to) => {
    lenis.stop();
    lenis.start();
    return before?.(to);
  };
}
