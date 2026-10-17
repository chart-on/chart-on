---
description: "Show numbers, dates and the built-in text in the user's language: locale-aware formats through Intl, message overrides and a translate hook."
---

# Localization

The `localization` chart option sets the language of the numbers, dates and built-in text a chart shows. Without it, the chart keeps its built-in English formats, character for character.

The option takes effect with the `localization()` [plugin](./features#opt-in-features), which `builtins()` includes. A chart without it keeps the built-in English (`englishLocalizer`), so an app that stays in English leaves the `Intl` code out. The option is still checked at the call, and development builds warn once ([`localization-missing`](./errors#localization-missing)) when it asks for anything.

```ts
import { createChart, localization } from '@charton/core';

const chart = createChart(container, {
  plugins: [localization()],
  localization: { locale: 'de-DE' },
});

// Later, e.g. from a language menu:
chart.applyOptions({ localization: { locale: 'fr-FR' } });
```

## Options

| Field | Default | Description |
| --- | --- | --- |
| `locale` | unset | BCP 47 tag such as `'de-DE'` or `'ja-JP'`. Decimal marks, minus and percent signs, digits, month and weekday names and the clock follow it through `Intl`. Unset: the built-in English formats |
| `decimalSeparator` | the locale's | Decimal mark for every number, whatever the locale says, e.g. `','` with an English locale |
| `grouping` | `false` | Group the digits of prices the locale's way, e.g. `1.234,50` in German; see below |
| `hourCycle` | the locale's, else `'h23'` | `'h12'` or `'h23'` |
| `dateFormat` | `{ day: 'numeric', month: 'short', year: 'numeric' }` | `Intl.DateTimeFormat` fields for the date in the crosshair label and other full dates. Time fields are ignored; the time follows `hourCycle`. The default names the month (or marks it, as `1月` does) and writes the whole year, in the locale's order (`Oct 16, 2026`, `16. Okt. 2026`, `2026年10月16日`), so day and month cannot be swapped and the century is never in doubt. Without `locale`, `dateFormat` or a 12-hour clock, the chart writes ISO 8601 instead (`2026-10-16 14:30`) |
| `messages` | `{}` | Your text by message key. Keys left out keep the English default |
| `translate` | unset | `(key, params) => string \| undefined`, asked first for every message, e.g. to hand keys to your i18n library. Return `undefined` to fall back |

`applyOptions({ localization })` merges the fields you pass into the current ones. A `messages` object replaces the previous one, so switching languages never leaves stale text behind. An invalid locale tag throws a `RangeError` and changes nothing.

## Locale packs

`@charton/locales` has ready-made translations of every built-in message of `@charton/core` and `@charton/ui`, including the built-in drawing tool names. Each language is its own entry, a `LocalizationOptions` object with `locale` and `messages`, so a bundle holds only the languages it imports, and an app that stays in English ships none.

```sh
pnpm add @charton/locales
```

```ts
import { createChart, localization } from '@charton/core';
import { zhCN } from '@charton/locales/zh-CN';

// A pack applies through the localization() plugin, which builtins() includes.
const chart = createChart(el, { plugins: [localization()] });
chart.applyOptions({ localization: zhCN });
```

| Entry | Export | Language |
| --- | --- | --- |
| `@charton/locales/de-DE` | `deDE` | German |
| `@charton/locales/es-ES` | `esES` | Spanish |
| `@charton/locales/fr-FR` | `frFR` | French |
| `@charton/locales/id-ID` | `idID` | Indonesian |
| `@charton/locales/ja-JP` | `jaJP` | Japanese |
| `@charton/locales/zh-CN` | `zhCN` | Chinese, Simplified |
| `@charton/locales/zh-TW` | `zhTW` | Chinese, Traditional (Taiwan) |

To change single messages, or add your own keys, spread the pack's `messages` and replace the ones you need. Other fields, such as `hourCycle`, go next to it:

```ts
chart.applyOptions({
  localization: { ...zhCN, hourCycle: 'h12', messages: { ...zhCN.messages, statusNoData: '没有行情' } },
});
```

The packs translate the chart settings dialog and the appearance panel (the `settings.`, `setting.` and `appearance.` keys below), but not indicator text from `@charton/indicators`, colour preset names (`preset.<id>`) or price source names (`source.<value>`) yet; those stay in English. The translations have not been reviewed by a fluent speaker yet: corrections are welcome.

To add a language, add `src/<tag>.ts` to `packages/locales` with the tag's export in its `package.json`, typed with `satisfies PackMessages`. The coverage test then checks it like the others: every core, shell and tool key, every key built from `chartSettingsSchema` and `appearanceSections`, and no unknown ones, the same `{placeholder}` names as the English text, and the plural forms (`<key>.one`, `<key>.few`, ...) that `Intl.PluralRules` lists for the tag. The plain key serves as the `other` form. `railMoreGroup`, `appearanceResetSection` and `appearanceShow` may use `{name}`, the name as written, in place of the lower-case `{group}` or `{lower}`, for languages that capitalize nouns.

## What follows the locale

- Price-axis, crosshair, legend and data-window prices, through the series' price format. A `custom` price format is your own text and is left as it is.
- Percent and indexed scale labels, compact amounts (volumes, `volume` price formats, large axis values) and default indicator values.
- Month names on the time axis, the time of day on intraday ticks, and the crosshair date and time.
- The accessible chart summary, new-bar announcements and the data table caption.

Prices are not grouped by default (`1234,50`, not `1.234,50`), to keep axis labels short. Set `grouping: true` to group them through `Intl`: `1.234,50` in German, `12,34,567.50` in `'en-IN'`, `1 234,50` in French, `١٬٢٣٤٫٥٠` in `'ar-EG'`, and `1,234.50` without a `locale`. The price axis, the crosshair, the legend and the data window follow, as does `chart.localization.price(value, decimals)`. A locale groups only the numbers it would group itself (Spanish writes `1234,50` but `12.345,50`). Price formats with a `unit` and `custom` formats are left as they are, and so are percentages, indexed values and compact amounts. When the group mark would read as the `decimalSeparator` (e.g. `','` with an English locale), prices are not grouped.

```ts
chart.applyOptions({ localization: { locale: 'de-DE', grouping: true } });
```

Compact amounts use the locale's own words and grouping through `Intl`: `1,25 Mio.` in German, `1.23L` (lakh) and `1.23Cr` (crore) in `'en-IN'`, `15 लाख` in `'hi-IN'`, `12.35万` in Japanese, `١٫٢٥ مليون` in `'ar-EG'`. A locale with no word for a size writes the whole number, grouped its way (`123.457` in German). English keeps `K`, `M`, `B` and `T`, as does a chart without a `locale`. `chart.localization.parseCompact(text)` reads these back, as does the `parse` of a `volume` price format; the `K`, `M`, `B` and `T` suffixes are accepted in every locale.

Digits follow the locale's numbering system: `'ar-EG'` writes `١٢٣٤٫٥٠` and `'fa-IR'` writes `۱۲۳۴٫۵۰`, on the price and time axes, in the crosshair, legend and percentages. Pick a numbering system with a `-u-nu-` tag, e.g. `'ar-u-nu-latn'` for Arabic with Latin digits or `'hi-IN-u-nu-deva'` for Devanagari digits. Typed prices parse back from either native or ASCII digits.

Text on the chart's canvases reads in its own direction, as `dir="auto"` text does in HTML: a label whose first letter is Arabic, Hebrew or another right-to-left script runs right to left, and anything else (numbers alone included) left to right, whatever direction the page sets. So mixed-script drawing text, marker and zone labels, legend titles and right-to-left date labels read in order, and `-1.25` stays `-1.25` in a `dir="rtl"` page. Each line of a multi-line callout or tooltip takes its own direction, and right-to-left lines align to the box's right edge. Time still runs left to right on the plot.

The [UI shell](./ui-shell.md) mirrors for right-to-left languages with its `direction` option: `'rtl'` puts the rail on the right and lays out the toolbar, menus, flyouts, dialogs, docked panels and the bottom bar from right to left, `'ltr'` keeps them left to right, and the default `'auto'` follows the page's `dir`. Change it later with `shell.setDirection()`. The plot, the time axis and the overview strip keep time running left to right.

The chart has a `direction` option of its own, which the shell passes its direction on to. In `'rtl'` the main price axis defaults to the left (an explicit `setPriceScaleOptions({ side })` wins), the legend's default `'top-start'` corner is the top right, and the pane buttons and the scroll-to-newest button sit on the left. The default `'auto'` reads the container's computed `direction` when the chart is created and on each `applyOptions`. In mirrored chrome the left and right arrow keys move the way they point (in toolbars, the rail, menus, submenus, tabs and the object tree), while on the chart and the overview strip left still means earlier.

```ts
const shell = createChartShell(el, { direction: 'rtl', chart: { localization: { locale: 'ar-EG' } } });
```

Typed prices parse back in the same language: a price format from `chart.localization.priceFormat(...)` accepts `101,26` in German, and still accepts a dot when no comma is typed. With `grouping` on it also accepts the locale's groups, e.g. `1.234,5` or `1.234` in German and `12,34,567` in `'en-IN'`; a typed space stands for the French narrow no-break space. A dot not followed by a group of three digits (`1.5`) still reads as a decimal point.

## Messages

Every built-in string has a key. The core keys and their English text are exported as `defaultMessages`; the shell's are `defaultShellMessages` from `@charton/ui`. `{name}` in a message marks a value filled in at run time.

```ts
chart.applyOptions({
  localization: {
    locale: 'de-DE',
    messages: {
      statusLoading: 'Wird geladen…',
      legendShowMore: '{count} weitere anzeigen',
      menuResetView: 'Ansicht zurücksetzen',
    },
  },
});
```

A message resolves in this order: `translate`, then `messages`, then the English default, then the key itself.

The keys localized so far:

- **Core:** chart name, scroll-to-newest button, data status (loading, no data, errors), market phase and delay badge, pane buttons, legend buttons, the legend's value labels (`legendOpen`, `legendHigh`, `legendLow`, `legendClose`, the volume profile's `legendPoc`, `legendVah`, `legendVal` and the points series' `legendCount`), the legend title of a series without one (`legendTitleCandles`, `legendTitleLine`, `legendTitleHistogram` and one per series kind), drawing tool names (see below), the drawing readouts (the measure, trend line with stats, trend angle, position and range tools: `measureBar`, `measureBars`, `measureDays`, `measureHours`, `measureMinutes`, `measureSeconds`, `positionTarget`, `positionStop`, `positionLongEntry`, `positionShortEntry`, `positionRiskReward`), the text drawing's placeholder, the timezone list's local entry (`timezoneLocal`), indicator text (see below), the accessible summary, new-bar announcements and table caption.
- **Shell:** the toolbar presets and the toolbar's "more" button, the drawing rail's own buttons and group names, the favourites bar and its stars, the bottom bar (range presets, timezone, session and scale controls, go to date), the chart context menu, the legend row menu (including its scale and "Show on" submenus), the bar replay controls, the plot style controls of the indicator settings panel, the drawing tools' double-click hint and kept-tool description, the `toggleVisibility` preset's name (`toolbarToggleVisibility`, `toolbarToggleDrawings`), the symbol search (`symbolSearch…` keys; its title is `actionSymbolSearch`), the close button of the shell's dialogs and panels (`dialogClose`), and the panels, dialogs and pickers below. The toast close button (`toastDismiss`), the navigator (`navigatorLabel`), the order editor (`draft…`), the order cluster list (`clusterOrders`, `clusterCancel`), the market sessions chip (`session…`), the depth ladder (`ladderTitle`, `ladderSize`) and the chart grid (`grid…`) follow as well.

`railMoreGroup` gets two values: `{name}`, the group's name as written, and `{group}`, the same in lower case, which the English text uses ("More lines").

### Drawing tool names

Tool names have no entry in `defaultMessages`. Their key is `tool.` and the tool's type, and the tool's `label` is the English default, so tools from plugins can be translated the same way:

```ts
chart.applyOptions({
  localization: { messages: { 'tool.trendline': 'Trendlinie', 'tool.fib-retracement': 'Fibonacci-Retracement' } },
});
chart.drawings.toolLabel('trendline'); // 'Trendlinie'
```

The rail, favourites bar, object tree, drawing settings title and the `draw-…` actions use `chart.drawings.toolLabel(type)`. As with toolbar items, a label the app set wins: a built-in tool (added with `drawingTools()` or `builtins()`) is translated only while its `label` is still the built-in English one, so `{ ...trendLine, label: 'Trend' }` shows "Trend" in every language. Tools of your own types have no built-in label, so their `tool.<type>` message always applies when your catalogue has one.

### Indicator text

Indicators have no entries in `defaultMessages` either. Their keys are made from the definition's id, and the definition's own text is the default, so indicators from packages and plugins translate the same way:

| Key | Names | Example |
| --- | --- | --- |
| `indicator.<id>` | The indicator's name in the picker, settings title, object tree and legend title | `'indicator.volume-ma': 'Volumen'` |
| `indicator.<id>.description` | Its description in the picker | |
| `input.<id>.<input>` | An input's label in the settings | `'input.sma.length': 'Länge'` |
| `input.<id>.<input>.<value>` | A choice of a `select` input | `'input.test.mode.simple': 'Einfach'` |
| `inputGroup.<id>.<group>` | A group of inputs, by its `group` text | `'inputGroup.moon-phase.Style': 'Stil'` |
| `plot.<id>.<plot>` | A plot's `title` in the settings | `'plot.bbands.upper': 'Oben'` |

The legend title is the translated name plus the number and source inputs, e.g. "Volumen 20". A definition with its own `title(inputs)` keeps that title, and a title the app set on the series stays when the language changes. The picker's search matches the translated name as well as the definition's name, aliases and id; `searchIndicators(defs, query, { nameOf })` and `matchRank(def, query, { name })` do the same for your own lists.

Because the keys join ids with dots, indicator ids and input ids cannot contain `.`: registering such a definition throws. Plot ids, group names and choice values may, since they come last in their key.

### Plurals

Counts pick the plural form of the language through `Intl.PluralRules`: the message `key.one`, `key.two`, `key.few`, `key.many` or `key.zero`, whichever the locale's rules select, else `key.other`, else the plain key. The drawing readouts' bar count uses `measureBars` (English falls back to `measureBar` for one bar) and the symbol search's result count `symbolSearchResults`:

```ts
messages: {
  'measureBars.one': '{count} бар', // 1, 21
  'measureBars.few': '{count} бара', // 2, 3, 4
  'measureBars.many': '{count} баров', // 5, 11
  'measureBars.other': '{count} бара',
}
```

`pluralText(chart.localization, key, count, params)` from `@charton/core` does the same for your own messages.

### Panels, dialogs and pickers

The appearance panel, the drawing settings and the selected-drawing toolbar, the chart, indicator and series settings, the indicator picker, the color picker and the shared form and picker dialogs use `defaultShellMessages` too: `dialog…` keys for the buttons and navigation they share (`dialogOk`, `dialogCancel`, `dialogReset`, `dialogResetDefaults`, `dialogDone`, `dialogSearch`, `dialogStyle`, …), `form…` for validation messages, `picker…` for the picker's loading and empty messages, `indicators…` for the indicator picker, `appearance…` and `drawing…` for the panels. Result counts use the plural keys of the symbol search (`symbolSearchResults`).

Labels made from an id have keys built from it instead of a fixed entry, like tool names:

| Key | Names | Example |
| --- | --- | --- |
| `appearance.section.<id>`, `appearance.<key>` | An appearance section (`candles`, `grid`, …), or a color or grid line (`up`, `background`, `horizontal`, …) | `'appearance.up': 'Steigender Körper'` |
| `preset.<id>` | A built-in color preset | `'preset.deep-ocean': 'Tiefsee'` |
| `category.<id>` | An indicator category in the picker, built-in or your own | `'category.trend': 'Trendfolger'` |
| `source.<value>` | A bar value of a `source` input (`open`, `close`, `hl2`, `volume`, …) | `'source.close': 'Schluss'` |
| `settings.<section>`, `settings.<section>.<group>` | A chart settings section or group | `'settings.readout': 'Werteanzeige'` |
| `setting.<path>`, `setting.<path>#hint`, `setting.<path>.<choice>` | A chart settings field, its hint and its choices | `'setting.legend.position.top-start': 'Oben am Anfang'` |

The English text of these keys is the label in the built-in data (`appearanceSections`, `builtInColorPresets`, `defaultSources`, `chartSettingsSchema`). As with `labelKey`, a built-in label is translated only while it is still the English default: a preset, section or field you renamed keeps your name in every language.

`createFormDialog` and `createPickerDialog` take a `localization` option, usually `chart.localization`, for their own text; without it they stay in English. So do `createDepthLadder` (read when it is made; a `title` you pass wins) and `createSessionChip(bands, now, { localization })`, which reads it on every tick, so a getter returning `chart.localization` follows language changes; `sessionStatusText` and `sessionChipLabel` take the same `{ localization }` options. The chart grid names itself, its cells and resize handles in the language of the active cell's chart, and relabels when another cell becomes active. A settings choice with `labelKey` and `labelParams`, like the timezone list's local entry, shows that message while its `label` is the English text of the key. Form actions take a `labelKey` like toolbar items. `formErrors`, `inputError` and `drawingSettingsForm` take `{ localization }` as an optional last argument, and `presetLabel` and `clusterRowText` do the same for the keypad's `draftMax` and the order sides (`clusterBuy`, `clusterSell`, `clusterLong`, `clusterShort`).

## Reading the language at run time

`chart.localization` formats in the chart's language. Use it in your own UI so it matches the chart:

```ts
const loc = chart.localization;
loc.number(1234.5, 2); // '1234,50' in German
loc.percent(1.5, 2, true); // '+1,50%'
loc.text('statusLoading'); // the message for a key
loc.text('myApp.saved', undefined, 'Saved'); // your own key with a fallback

chart.on('localization:change', ({ locale }) => {
  // `chart.localization` is a new object now; re-render your labels.
});
```

Menus and dialogs are built (or relabelled) each time they open, so they pick up a new language straight away; a dialog or settings panel that is already open keeps its text until it opens again. The toolbar, rail, favourites bar, bottom bar (with its sessions chip), legend (indicator titles too), replay controls, selected-drawing toolbar, navigator, chart grid and the narrow layout's drawing tools button relabel themselves on `localization:change`. A symbol search made with `createSymbolSearch` outside a shell takes its language from the `chart` option. Toolbar and rail items name their message with `labelKey` (see [the toolbar](./ui-shell#toolbar)), so your own items can switch language the same way.
