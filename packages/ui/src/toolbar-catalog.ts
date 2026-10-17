import { RotateCcw } from 'lucide';
import type { ToolbarItem } from './toolbar';
import { fullscreen, screenshot, toggleRail, toggleVisibility, undoRedo } from './toolbar-presets';
import { labelOf } from './messages';

/** Built-ins keep their preset ids; app defaults with the same id take precedence. */
export function toolbarBuiltins(): ToolbarItem[] {
  return [screenshot(), fullscreen(), ...undoRedo(), toggleRail(),
    { ...toggleVisibility('drawings'), group: 'view' },
    {
      type: 'button', id: 'reset-view', group: 'view', icon: RotateCcw,
      ...labelOf('menuResetView'),
      onClick: (chart) => { chart.actions.run('reset-view'); },
    },
  ];
}
