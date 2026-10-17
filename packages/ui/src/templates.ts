/**
 * `@charton/ui/templates`: style templates for the drawing settings dialog and
 * the indicator settings panel, an opt-in add-on. Pass `drawingTemplates()` or
 * `indicatorTemplates()` as their `headerControl`. Their menus can also save
 * a tool's or an indicator's settings as the default for new ones.
 */
import {
  createLocalStorageAdapter,
  resolveInputs,
  type DrawingStyle,
  type Indicator,
  type IndicatorDef,
  type InputValue,
  type NotificationKind,
  type StorageAdapter,
  type TemplateKind,
} from '@charton/core';
import {
  askTemplateName,
  confirmDialog,
  menuButton,
  shellText,
  templateNameTaken,
  type DrawingSettingsContext,
  type DrawingSettingsOptions,
  type FormDialog,
  type FormValues,
  type IndicatorInitialState,
  type IndicatorSettingsContext,
  type IndicatorSettingsOptions,
  type MenuOption,
  type ShellMessageKey,
} from '@charton/ui';
import { LayoutTemplate, Trash2 } from 'lucide';

/** Options for `drawingTemplates` and `indicatorTemplates`. */
export interface DrawingTemplatesOptions {
  /**
   * Where the templates are kept: the `'drawing'` templates of a storage
   * adapter, one list per tool type, or the `'indicator'` ones, one list per
   * indicator id. Default `createLocalStorageAdapter()`. An adapter without
   * the template methods shows no menu.
   */
  storage?: StorageAdapter;
  /**
   * Drawings only: `true` adds **Save as default** and **Reset default** to
   * the menu, which set the tool's defaults (`chart.drawings.setToolDefaults`)
   * to the style fields shown, or clear them. Those stay in the layout, not in
   * `storage`.
   */
  defaults?: boolean;
}

/** Options for `indicatorTemplates`. */
export interface IndicatorTemplateMenuOptions {
  /** Where the `'indicator'` templates are kept, one list per indicator id; see `DrawingTemplatesOptions.storage`. */
  storage?: StorageAdapter;
  /** Adds **Save as default** and **Reset default** to the menu, kept by these defaults; see `indicatorDefaults`. */
  defaults?: IndicatorDefaults;
}

/** Options for `indicatorDefaults`. */
export interface IndicatorDefaultsOptions {
  /** Where the defaults are kept: the `'indicator-default'` templates of a storage adapter. Default `createLocalStorageAdapter()`. */
  storage?: StorageAdapter;
}

/**
 * Per indicator id, the inputs and plot styles new indicators start with,
 * from `indicatorDefaults`. `save` and `reset` are missing when the storage
 * adapter cannot keep templates.
 */
export interface IndicatorDefaults {
  /**
   * The saved default of `def`'s indicator id, or null for none; pass it as
   * the indicator picker's `initialState`. A default saved for another
   * `version` of the definition, or with inputs it refuses, gives null with
   * a console warning. Never rejects.
   */
  initialState(def: IndicatorDef): Promise<IndicatorInitialState | null>;
  /** Make `indicator`'s inputs and plot styles the default of its indicator id. */
  save?(indicator: Indicator): Promise<void>;
  /** Remove the default of indicator id `type`, so new ones start from the definition's defaults again. */
  reset?(type: string): Promise<void>;
}

/** English text of the menu's own message keys; the chart's localization may translate them. */
const MESSAGES = {
  drawingTemplate: 'Template',
  templatesSaveAs: 'Save as template…',
  templatesApply: 'Apply template',
  templatesSaveDefault: 'Save as default',
  templatesResetDefault: 'Reset default',
  templatesDefaultSaved: 'Saved as default',
  templatesDefaultReset: 'Default reset',
};

/** What the menu's Save as default (`save` true) and Reset default (false) run. */
type SetDefault = (save: boolean) => unknown;

const DEFAULT_KIND = 'indicator-default';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
/** Drawing levels each with a finite value; the dialog's own checks cover the other fields. */
const levels = (v: unknown) => Array.isArray(v) && v.every((level) => isRecord(level) && finite(level.value));

/** A settings dialog's header control showing the Template menu for templates of `kind`, with `defaults`' actions, when `storage` keeps templates. */
const control =
  <C extends DrawingSettingsContext>(kind: TemplateKind, storage: StorageAdapter = createLocalStorageAdapter(), defaults?: (context: C) => SetDefault) =>
  (context: C) =>
    storage.listTemplates && storage.loadTemplate && storage.saveTemplate ? templateMenu(context, storage, kind, defaults?.(context)) : null;

/**
 * Style templates in the drawing settings dialog, as its `headerControl`: a
 * **Template** menu in the header. **Save as template…** asks for a name and
 * saves the style fields as shown; names compare without case, and a taken
 * name is refused. A saved name fills those fields in as a preview, so Ok
 * commits it as one undo step and Cancel drops it; only fields the dialog
 * shows, with a value it accepts, are taken. The names are listed again
 * under Delete, which asks first.
 *
 * @example
 * ```ts
 * import { createChartShell } from '@charton/ui';
 * import { drawingTemplates } from '@charton/ui/templates';
 *
 * createChartShell(el, { drawingSettings: { headerControl: drawingTemplates() } });
 * ```
 */
export function drawingTemplates(options: DrawingTemplatesOptions = {}): NonNullable<DrawingSettingsOptions['headerControl']> {
  return control(
    'drawing',
    options.storage,
    options.defaults
      ? ({ chart, type, style }) =>
          (save) =>
            chart.drawings.setToolDefaults(type, save ? (style() as DrawingStyle) : null)
      : undefined,
  );
}

/**
 * Templates in the indicator settings panel, as its `headerControl`: the same
 * **Template** menu as `drawingTemplates`, saving the indicator's inputs and
 * plot styles as `'indicator'` templates of its id. A saved name applies live,
 * so Ok keeps it as one undo step and Cancel puts the indicator back. With
 * `defaults`, the menu also has **Save as default** and **Reset default**.
 *
 * @example
 * ```ts
 * import { createChartShell } from '@charton/ui';
 * import { indicatorDefaults, indicatorTemplates } from '@charton/ui/templates';
 *
 * const defaults = indicatorDefaults();
 * createChartShell(el, {
 *   indicatorSettings: { headerControl: indicatorTemplates({ defaults }) },
 *   indicatorPicker: { initialState: defaults.initialState },
 * });
 * ```
 */
export function indicatorTemplates(options: IndicatorTemplateMenuOptions = {}): NonNullable<IndicatorSettingsOptions['headerControl']> {
  const { save, reset } = options.defaults ?? {};
  return control(
    'indicator',
    options.storage,
    save && reset ? ({ indicator, type }: IndicatorSettingsContext) => (saving) => (saving ? save(indicator) : reset(type)) : undefined,
  );
}

/**
 * Saved defaults for new indicators, one per indicator id, kept as the
 * `'indicator-default'` templates of `storage`. Give it to
 * `indicatorTemplates({ defaults })` for the menu items, and its
 * `initialState` to the indicator picker so indicators added there start
 * from the saved default; indicators added from code do not.
 */
export function indicatorDefaults({ storage = createLocalStorageAdapter() }: IndicatorDefaultsOptions = {}): IndicatorDefaults {
  const kept = storage.loadTemplate && storage.saveTemplate && storage.removeTemplate;
  return {
    async initialState(def) {
      try {
        // Stored content is untrusted: inputs are checked as `add` would; the picker skips plot styles it refuses.
        const saved = kept ? await storage.loadTemplate!(DEFAULT_KIND, 'default', def.id) : null;
        if (!isRecord(saved)) return null;
        if ((saved.version ?? 1) !== (def.version ?? 1)) throw new Error('saved for another version');
        resolveInputs(def.inputs, saved.inputs as Record<string, InputValue>);
        return saved as IndicatorInitialState;
      } catch (error) {
        console.warn('Indicator default not used:', def.id, error);
        return null;
      }
    },
    ...(kept && {
      async save(indicator: Indicator) {
        const { version, inputs, plotStyles } = indicator.serialize();
        await storage.saveTemplate!(DEFAULT_KIND, 'default', { version, inputs, plotStyles }, indicator.type);
      },
      async reset(type: string) {
        await storage.removeTemplate!(DEFAULT_KIND, 'default', type);
      },
    }),
  };
}

/**
 * The Template menu of one dialog (an indicator panel's context has the same
 * members). Menu values: `s` save, `a<i>` apply and `d<i>` delete the i-th name.
 */
function templateMenu(
  { chart, host, type, style, setStyle }: DrawingSettingsContext,
  storage: StorageAdapter,
  kind: TemplateKind,
  setDefault?: SetDefault,
) {
  const t = (key: ShellMessageKey, params?: Record<string, string>) => shellText(chart, key, params);
  const own = (key: keyof typeof MESSAGES) => chart.localization.text(key, undefined, MESSAGES[key]);
  const notify = (message: string, level: NotificationKind = 'info') => chart.notify({ message, kind: level });
  const failed = (error: unknown) => {
    console.error('Templates:', error);
    notify(t('templatesFailed'), 'error');
  };
  // The name prompt and the delete question close with the settings dialog.
  let prompt: FormDialog | null = null;
  const closed = new AbortController();
  let names: string[] = [];
  const options = (): MenuOption[] => [
    { value: 's', label: own('templatesSaveAs') },
    ...(setDefault ? [{ value: 'S', label: own('templatesSaveDefault') }, { value: 'R', label: own('templatesResetDefault') }] : []),
    ...names.map((label, i) => ({ value: `a${i}`, label, section: own('templatesApply') })),
    ...(storage.removeTemplate ? names.map((label, i) => ({ value: `d${i}`, label, icon: Trash2, section: t('drawingDelete') })) : []),
  ];
  const load = () =>
    storage.listTemplates!(kind, type).then((list) => {
      names = list;
      if (!closed.signal.aborted) menu.update({ options: options() });
      return list;
    });
  const save = (content: FormValues) => {
    prompt = askTemplateName(host, chart, own('templatesSaveAs'), '', (name) => {
      prompt = null;
      if (name === null) return;
      // Checked against the names stored now, so one saved meanwhile is refused too.
      load()
        .then(async (fresh) => {
          if (templateNameTaken(fresh, name)) return notify(t('templatesNameTaken'), 'error');
          await storage.saveTemplate!(kind, name, content, type);
          notify(t('templatesSaved', { name }), 'success');
          await load();
        })
        .catch(failed);
    });
  };
  const apply = (content: unknown) => {
    // Stored content is untrusted: level lists must hold finite values, and `setStyle` drops what the form refuses.
    const shown = style();
    const values = Object.fromEntries(Object.entries(isRecord(content) ? content : {}).filter(([key, value]) => !Array.isArray(shown[key]) || levels(value)));
    if (!setStyle(values)) notify(t('templatesInvalid'), 'error');
  };
  const remove = async (name: string) => {
    const sure = await confirmDialog(host, {
      title: t('templatesDeleteTitle'),
      message: t('templatesDeleteMessage', { name }),
      confirmLabel: t('drawingDelete'),
      cancelLabel: t('templatesCancel'),
      closeLabel: t('dialogClose'),
      destructive: true,
      signal: closed.signal,
    });
    if (!sure) return;
    await storage.removeTemplate!(kind, name, type);
    notify(t('templatesDeleted', { name }));
    await load();
  };
  const menu = menuButton({
    label: own('drawingTemplate'),
    text: own('drawingTemplate'),
    icon: LayoutTemplate,
    options: options(),
    onSelect: (value) => {
      menu.set(undefined);
      const name = names[Number(value.slice(1))];
      if (value === 's') save(style());
      else if (value === 'S' || value === 'R') {
        const saving = value === 'S';
        Promise.resolve(saving)
          .then(setDefault)
          .then(() => notify(own(saving ? 'templatesDefaultSaved' : 'templatesDefaultReset'), saving ? 'success' : 'info'), failed);
      } else if (name === undefined) return;
      else if (value[0] === 'a') storage.loadTemplate!(kind, name, type).then(apply).catch(failed);
      else remove(name).catch(failed);
    },
  });
  load().catch(failed);
  return {
    el: menu.el,
    destroy() {
      closed.abort();
      prompt?.close();
      menu.destroy();
    },
  };
}
