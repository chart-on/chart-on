import { dispatch } from '../../core/test/fake-dom';

type Node = HTMLElement & { children: Node[] };

const all = (root: Node): Node[] => root.children.flatMap((c) => [c, ...all(c)]);

/** The rows of the list a select trigger opened. */
export const listOptions = (trigger: HTMLElement): HTMLElement[] =>
  all(trigger.parentElement as Node).filter((el) => el.getAttribute('role') === 'option');

/** Pick option `which` (its index, or its label) from a themed select, as a click on its row. */
export function chooseOption(trigger: HTMLElement, which: number | string): void {
  dispatch(trigger, 'click');
  const rows = listOptions(trigger);
  const row = typeof which === 'number' ? rows[which] : rows.find((r) => r.getAttribute('title') === which);
  if (!row) throw new Error(`no option ${which}`);
  dispatch(row, 'click');
}

/** The label a themed select shows. */
export const chosenLabel = (trigger: HTMLElement): string | null => trigger.getAttribute('title');
