import { flushSync, mount, unmount, type Component } from 'svelte';

export interface Rendered<Props> {
  container: HTMLElement;
  /** The props the component renders with; assign them, then call `flush()`. */
  props: Props;
  /** Apply pending changes and run the effects they caused. */
  flush(): void;
  unmount(): void;
}

/**
 * Props whose every key is its own raw state: assigning a key updates the
 * component, while the values themselves stay as they are, not proxied. Pass
 * every key the test will assign, `undefined` if unset for now.
 */
function shallowProps<Props extends Record<string, unknown>>(initial: Props): Props {
  const props = {} as Props;
  for (const key of Object.keys(initial)) {
    let value = $state.raw(initial[key]);
    Object.defineProperty(props, key, { enumerable: true, get: () => value, set: (next) => (value = next) });
  }
  return props;
}

/** `value` as deep state, so changes inside it reach the component, as with `$state` in an app. */
export function deep<T>(value: T): T {
  const state = $state(value);
  return state;
}

/**
 * Mount `component` into a fresh element in the page with reactive `props`.
 * Effects run before this returns, as they do after a component is mounted in
 * an app.
 */
export function render<Props extends Record<string, unknown>>(component: Component<never>, props: Props): Rendered<Props> {
  const container = document.createElement('div');
  document.body.append(container);
  const state = shallowProps(props);
  const instance = mount(component as unknown as Component<Props>, { target: container, props: state });
  flushSync();
  return {
    container,
    props: state,
    flush: () => flushSync(),
    unmount() {
      unmount(instance);
      flushSync();
      container.remove();
    },
  };
}
