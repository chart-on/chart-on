/**
 * Shell parts that can be shown or hidden at runtime. A hidden part keeps its
 * state and listeners. Parts the shell was created without stay absent.
 */
export interface ShellFeatures {
  /** Top toolbar. */
  toolbar: boolean;
  /** Left drawing-tool rail. */
  rail: boolean;
  /** Bottom bar with range presets and scale toggles. */
  bottomBar: boolean;
  /** Floating box beside the pointer with the hovered bar's values (see `createPointerTooltip`). Off by default. */
  tooltip: boolean;
  /**
   * Compact layout below the shell's `railBreakpoint`: the rail opens as a
   * bottom sheet and the range presets collapse into a menu. Off by default.
   */
  railSheet: boolean;
  /** The command palette and its shortcut (Mod+K by default), while the shell has one (its `commandPalette` option). On by default. */
  commandPalette: boolean;
}

/** The default shell feature flags: toolbar, rail, bottom bar and command palette on; pointer tooltip and rail sheet off. */
export const defaultShellFeatures: Readonly<ShellFeatures> = {
  toolbar: true,
  rail: true,
  bottomBar: true,
  tooltip: false,
  railSheet: false,
  commandPalette: true,
};

/** Merge flag changes into `current`. Undefined values leave a flag unchanged. */
export function resolveShellFeatures(current: Readonly<ShellFeatures>, patch: Partial<ShellFeatures> = {}): ShellFeatures {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    // Unknown flags are left out; development builds warn about them in `checkOptions`.
    if (!Object.hasOwn(defaultShellFeatures, key)) continue;
    if (value !== undefined) next[key as keyof ShellFeatures] = Boolean(value);
  }
  return next;
}
