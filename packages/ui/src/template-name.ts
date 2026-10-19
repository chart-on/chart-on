import type { Chart } from '@chart-on/core';
import { createFormDialog, type FormDialog } from './form-dialog';
import { shellText, type ShellMessageKey } from './messages';

/**
 * Ask for a template name in a short dialog titled `title` over `host`,
 * starting from `current` (empty for a new template, the old name for a
 * rename), in the chart's language. `done` gets the trimmed name on Save,
 * null on Cancel. The indicator and drawing template menus use it.
 */
export function askTemplateName(host: HTMLElement, chart: Chart, title: string, current: string, done: (name: string | null) => void): FormDialog {
  const text = (key: ShellMessageKey) => shellText(chart, key);
  const prompt = createFormDialog(
    host,
    {
      id: 'template-name',
      title,
      sections: [
        {
          id: 'name',
          title: '',
          groups: [{ id: 'name', inputs: [{ kind: 'text', id: 'name', label: text('templatesName'), required: true, maxLength: 100 }] }],
        },
      ],
      actions: [
        { id: 'cancel', label: text('templatesCancel'), role: 'cancel' },
        { id: 'ok', label: text('templatesSaveButton'), role: 'submit' },
      ],
    },
    {
      values: { name: current },
      localization: chart.localization,
      onAction: (action, values) => done(action === 'ok' ? String(values.name).trim() : null),
    },
  );
  prompt.el.querySelector('.pc-form-dialog')?.classList.add('pc-form-dialog--short');
  return prompt;
}

/** Whether `name` is in `names` other than as `current`; names compare without case, so "Trend" and "trend" are one template. */
export function templateNameTaken(names: readonly string[], name: string, current = ''): boolean {
  const folded = name.toLowerCase();
  return folded !== current.toLowerCase() && names.some((n) => n.toLowerCase() === folded);
}
