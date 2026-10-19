import type { CoreMessageKey } from '@chart-on/core';
import type { ShellMessageKey } from '@chart-on/ui';

/**
 * The messages of a locale pack: every built-in core and shell key, so a key
 * renamed or removed upstream fails the type check, plus the built-in drawing
 * tool names (`tool.<type>`), the chart settings and appearance panel text
 * (`settings.`, `setting.` and `appearance.` keys) and, for languages that
 * need them, plural forms (`<key>.one`, `<key>.few`, ...). The coverage test
 * checks all but the core and shell keys.
 */
export type PackMessages = Record<CoreMessageKey | ShellMessageKey, string> & {
  readonly [key: `${'tool' | 'settings' | 'setting' | 'appearance'}.${string}` | `${string}.${Intl.LDMLPluralRule}`]: string;
};
