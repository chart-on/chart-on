import { createApp, h, nextTick, reactive, type App, type Component, type VNodeChild } from 'vue';

export interface Rendered<Props, Exposed> {
  container: HTMLElement;
  app: App;
  /** The props the component renders with; change them, then `await flush()`. */
  props: Props;
  /** Every value the template ref received, oldest first. */
  refs: (Exposed | null)[];
  /** Let the framework apply pending changes. */
  flush(): Promise<void>;
  unmount(): void;
}

/**
 * Mount `component` into a fresh element in the page with reactive `props`,
 * recording what its template ref receives. Warnings fail the test.
 */
export function render<Props extends object, Exposed>(component: Component, props: Props, children?: () => VNodeChild): Rendered<Props, Exposed> {
  const container = document.createElement('div');
  document.body.append(container);
  const state = reactive(props) as Props;
  const refs: (Exposed | null)[] = [];
  const app = createApp({
    render: () => h(component, { ...state, ref: (value: unknown) => void refs.push(value as Exposed | null) }, children ? { default: children } : undefined),
  });
  app.config.warnHandler = (message) => {
    throw new Error(`framework warning: ${message}`);
  };
  app.mount(container);
  return {
    container,
    app,
    props: state,
    refs,
    flush: () => nextTick(),
    unmount() {
      app.unmount();
      container.remove();
    },
  };
}
