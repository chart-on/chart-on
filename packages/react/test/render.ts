import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Tells the framework that updates in these tests are wrapped in `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rendered {
  container: HTMLElement;
  root: Root;
  rerender(element: ReactElement): Promise<void>;
  unmount(): Promise<void>;
}

/** Render `element` into a fresh element in the page, running its effects. */
export async function render(element: ReactElement): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    root,
    rerender: (next) => act(async () => root.render(next)),
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
