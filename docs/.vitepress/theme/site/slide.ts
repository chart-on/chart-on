/**
 * A highlight that slides to the selected item of a tab group (the item with
 * `aria-selected` or `aria-checked` set to true), instead of each item fading
 * its own background. Follows selection, added items and layout changes.
 * Returns a function that removes it.
 */
export function slidingIndicator(group: HTMLElement): () => void {
  const indicator = document.createElement('span');
  indicator.className = 'lp-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  group.prepend(indicator);
  group.classList.add('lp-sliding');

  const place = () => {
    // Groups that rebuild their items (replaceChildren) drop it too.
    if (indicator.parentElement !== group) group.prepend(indicator);
    const item = group.querySelector<HTMLElement>('[aria-selected="true"], [aria-checked="true"]');
    indicator.hidden = !item;
    if (!item) return;
    indicator.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
    indicator.style.width = `${item.offsetWidth}px`;
    indicator.style.height = `${item.offsetHeight}px`;
  };

  place();
  // Jump into place first, slide from then on.
  requestAnimationFrame(() => indicator.classList.add('lp-indicator-ready'));

  const mutations = new MutationObserver(place);
  mutations.observe(group, { subtree: true, childList: true, attributeFilter: ['aria-selected', 'aria-checked'] });
  const resizes = new ResizeObserver(place);
  resizes.observe(group);

  return () => {
    mutations.disconnect();
    resizes.disconnect();
    indicator.remove();
    group.classList.remove('lp-sliding');
  };
}
