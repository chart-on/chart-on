import type { PluginContext } from '@chart-on/core';
import type { ToolbarHandle, ToolbarItem, ToolbarPlacement } from './toolbar';

/** What the shell offers plugins (see `shellOf`). */
export interface ShellPluginHost {
  /**
   * Add a top-bar item (give it a `group`, see `roadmap/toolbar-layout.md`);
   * returns a function that removes it. Does nothing without a toolbar.
   */
  addToolbarItem(item: ToolbarItem, placement?: ToolbarPlacement): () => void;
}

/** The host a shell registers on its chart under `'shell'`. */
export function createShellHost(toolbar: ToolbarHandle | null): ShellPluginHost {
  return {
    addToolbarItem(item, placement) {
      if (!toolbar || item.type === 'separator' || item.type === 'spacer') return () => {};
      toolbar.add(item, placement);
      return () => toolbar.remove(item.id);
    },
  };
}

/**
 * The shell, as a plugin's `install` sees it: items it adds are removed when
 * the plugin is uninstalled. Null when the chart has no shell.
 *
 * ```ts
 * install(ctx) {
 *   shellOf(ctx)?.addToolbarItem({ type: 'button', id: 'ruler', group: 'analysis', ... });
 * }
 * ```
 */
export function shellOf(ctx: PluginContext): ShellPluginHost | null {
  const host = ctx.host<ShellPluginHost>('shell');
  if (!host) return null;
  return {
    addToolbarItem(item, placement) {
      const remove = host.addToolbarItem(item, placement);
      ctx.onDispose(remove);
      return remove;
    },
  };
}
