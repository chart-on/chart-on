/**
 * How a shell part sits around the chart: `floating`, a rounded card inset
 * from the shell's edges; `docked`, a square strip flush with them; `inset`,
 * no fill, on the shell background, with the chart stage as the raised card.
 */
export type ShellPanelStyle = 'floating' | 'docked' | 'inset';

/** The panel style of each shell part. */
export interface ShellPanels {
  toolbar: ShellPanelStyle;
  rail: ShellPanelStyle;
  bottomBar: ShellPanelStyle;
}

/** Every part floats unless the app says otherwise: rounded cards read as one tool on any page background. */
export const defaultShellPanels: Readonly<ShellPanels> = { toolbar: 'floating', rail: 'floating', bottomBar: 'floating' };

/** One style for every part, or the parts given; parts left out keep their style in `current`. */
export function resolveShellPanels(current: Readonly<ShellPanels>, next: ShellPanelStyle | Partial<ShellPanels> = {}): ShellPanels {
  if (typeof next === 'string') return { toolbar: next, rail: next, bottomBar: next };
  const { toolbar = current.toolbar, rail = current.rail, bottomBar = current.bottomBar } = next;
  return { toolbar, rail, bottomBar };
}

/**
 * Write the styles to the shell element for the stylesheet: one attribute per
 * part, and `data-pc-panels` with the shared style, or `mixed`.
 */
export function markShellPanels(el: HTMLElement, { toolbar, rail, bottomBar }: ShellPanels): void {
  el.setAttribute('data-pc-toolbar', toolbar);
  el.setAttribute('data-pc-rail', rail);
  el.setAttribute('data-pc-bottom-bar', bottomBar);
  el.setAttribute('data-pc-panels', toolbar === rail && rail === bottomBar ? toolbar : 'mixed');
}
