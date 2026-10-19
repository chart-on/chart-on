import type { LocalizationOptions } from '@chart-on/core';
import { deDE } from '@chart-on/locales/de-DE';
import { esES } from '@chart-on/locales/es-ES';
import { frFR } from '@chart-on/locales/fr-FR';
import { idID } from '@chart-on/locales/id-ID';
import { jaJP } from '@chart-on/locales/ja-JP';
import { zhCN } from '@chart-on/locales/zh-CN';
import { zhTW } from '@chart-on/locales/zh-TW';

/**
 * Languages the demo's settings dialog switches between: the built-in English,
 * English (US) for its formats only, and the `@chart-on/locales` packs, which
 * translate the chart and the shell. Numbers and dates come from `Intl`.
 */
export const DEMO_LOCALES: readonly { value: string; label: string; options: LocalizationOptions }[] = [
  { value: 'builtin', label: 'English', options: { locale: undefined, messages: {} } },
  { value: 'en-US', label: 'English (US)', options: { locale: 'en-US', messages: {} } },
  { value: 'de-DE', label: 'Deutsch', options: deDE },
  { value: 'es-ES', label: 'Español', options: esES },
  { value: 'fr-FR', label: 'Français', options: frFR },
  { value: 'id-ID', label: 'Bahasa Indonesia', options: idID },
  { value: 'ja-JP', label: '日本語', options: jaJP },
  { value: 'zh-CN', label: '简体中文', options: zhCN },
  { value: 'zh-TW', label: '繁體中文', options: zhTW },
];
