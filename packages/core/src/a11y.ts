/** What the chart exposes to assistive technology (screen readers). */
export interface AccessibilityOptions {
  /**
   * Describe the chart to screen readers: symbol, interval, visible range,
   * last price and change, read when the chart gets focus. Default true.
   */
  summary: boolean;
  /** Read the values under the crosshair as it moves (a polite live region). Default false. */
  crosshairReadout: boolean;
  /** The chart's accessible name. Default: `'<symbol> chart'`, or `'Chart'` without a symbol. */
  label?: string;
  /** Shortest time between updates of the summary and the readout, ms. Default 1000. */
  throttleMs: number;
  /**
   * Announce each new bar of the main series (its time and the close and
   * change of the bar before it) in a polite live region. Default false.
   */
  announceBars: boolean;
  /**
   * Shortest time between two announcements, new bars and `chart.announce`
   * alike, ms. Bars that arrive faster are skipped for the newest. Default 5000.
   */
  announceIntervalMs: number;
}

/** Default values for `AccessibilityOptions`: the summary on, the crosshair readout and bar announcements off. */
export const defaultAccessibilityOptions: AccessibilityOptions = {
  summary: true,
  crosshairReadout: false,
  throttleMs: 1000,
  announceBars: false,
  announceIntervalMs: 5000,
};

/** App messages waiting for their turn; older ones are dropped past this. */
const ANNOUNCE_QUEUE = 3;

let nextId = 0;

/**
 * A div that is present but not visible: screen readers read it, layout and
 * pointer ignore it. With `live` it is a polite live region; `role` goes in
 * `data-role`.
 */
export function hiddenText(live = false, role?: string): HTMLDivElement {
  const el = document.createElement('div');
  if (live) {
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
  }
  if (role) el.dataset.role = role;
  Object.assign(el.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    border: '0',
  });
  return el;
}

/**
 * Text that changes often, written at most once per `wait` ms. The text is
 * produced when it is written, so a burst of changes builds it once, and the
 * last change always lands.
 */
class Throttled {
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  #produce: (() => string) | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly wait: () => number,
  ) {}

  request(produce: () => string): void {
    this.#produce = produce;
    if (this.timer) return;
    const due = this.last + this.wait() - Date.now();
    if (due <= 0) this.#flush();
    else this.timer = setTimeout(() => this.#flush(), due);
  }

  #flush(): void {
    this.timer = null;
    const produce = this.#produce;
    this.#produce = null;
    if (!produce) return;
    const text = produce();
    if (this.el.textContent !== text) this.el.textContent = text;
    this.last = Date.now();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.#produce = null;
  }
}

/**
 * Announcements at most one per `wait` ms: app messages in order (the newest
 * few kept), then the latest new-bar text.
 */
class Announcer {
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly #messages: string[] = [];
  #bar: (() => string) | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly wait: () => number,
  ) {}

  message(text: string): void {
    this.#messages.push(text);
    if (this.#messages.length > ANNOUNCE_QUEUE) this.#messages.shift();
    this.#schedule();
  }

  newBar(produce: () => string): void {
    this.#bar = produce;
    this.#schedule();
  }

  #schedule(): void {
    if (this.timer) return;
    const due = this.last + this.wait() - Date.now();
    if (due <= 0) this.#flush();
    else this.timer = setTimeout(() => this.#flush(), due);
  }

  #flush(): void {
    this.timer = null;
    let text = this.#messages.shift();
    if (text === undefined && this.#bar) {
      text = this.#bar();
      this.#bar = null;
    }
    if (text === undefined) return;
    // The same words again must still change the region, or they are not read.
    if (this.el.textContent === text) text += '\u00a0';
    this.el.textContent = text;
    this.last = Date.now();
    if (this.#messages.length || this.#bar) this.#schedule();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.#messages.length = 0;
    this.#bar = null;
  }
}

/**
 * The chart root's accessible name and description, and an optional live
 * readout of the crosshair values, in visually hidden elements.
 */
export class ChartDescription {
  readonly #summaryEl: HTMLDivElement;
  readonly #readoutEl: HTMLDivElement;
  readonly #announceEl: HTMLDivElement;
  readonly #summary: Throttled;
  readonly #readout: Throttled;
  readonly #announcer: Announcer;

  constructor(
    private readonly root: HTMLElement,
    private options: AccessibilityOptions,
  ) {
    const id = `pc-chart-summary-${++nextId}`;
    this.#summaryEl = hiddenText();
    this.#summaryEl.id = id;
    this.#readoutEl = hiddenText(true);
    // Separate from the readout, so moving the crosshair never cuts an announcement short.
    this.#announceEl = hiddenText(true, 'announcements');
    root.append(this.#summaryEl, this.#readoutEl, this.#announceEl);
    // It handles its own keys (pan, zoom, drawings), so screen readers pass them through.
    root.setAttribute('role', 'application');
    root.setAttribute('aria-roledescription', 'chart');
    root.setAttribute('aria-describedby', id);
    const wait = () => this.options.throttleMs;
    this.#summary = new Throttled(this.#summaryEl, wait);
    this.#readout = new Throttled(this.#readoutEl, wait);
    this.#announcer = new Announcer(this.#announceEl, () => this.options.announceIntervalMs);
  }

  setOptions(options: AccessibilityOptions): void {
    this.options = options;
    if (!options.summary) this.#summary.request(() => '');
    if (!options.crosshairReadout) this.#readout.request(() => '');
  }

  /** The accessible name, from `label`, else `fallback` (the chart's localized name), else the symbol. */
  setLabel(symbol: string | null, fallback?: string): void {
    const label = this.options.label ?? fallback ?? (symbol ? `${symbol} chart` : 'Chart');
    if (this.root.getAttribute('aria-label') !== label) this.root.setAttribute('aria-label', label);
  }

  /** The view or the data changed: rebuild the summary with `produce` when the throttle allows. */
  summaryChanged(produce: () => string): void {
    if (this.options.summary) this.#summary.request(produce);
  }

  /** The crosshair moved: read `produce` out when the throttle allows. */
  readoutChanged(produce: () => string): void {
    if (this.options.crosshairReadout) this.#readout.request(produce);
  }

  /** A new main-series bar arrived: announce `produce` when `announceBars` is on and the rate allows. */
  newBar(produce: () => string): void {
    if (this.options.announceBars) this.#announcer.newBar(produce);
  }

  /** Read `text` out in the announcement region, in turn with the others (see `announceIntervalMs`). */
  announce(text: string): void {
    this.#announcer.message(text);
  }

  dispose(): void {
    this.#summary.dispose();
    this.#readout.dispose();
    this.#announcer.dispose();
  }
}
