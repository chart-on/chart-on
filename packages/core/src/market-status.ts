import type { CoreMessageKey, Localizer } from './util/locale';
import { marketPhase, type MarketPhase, type MarketStatus } from './util/market';

// `chart.marketStatus()` and the legend badge of the `marketStatus` option: the market phase from
// the session options, and the data delay. The `marketStatus()` plugin gives the chart this, so a
// chart without it leaves it out.

const PHASE_LABELS: Record<MarketPhase, CoreMessageKey> = {
  pre: 'marketPre',
  open: 'marketOpen',
  post: 'marketPost',
  closed: 'marketClosed',
};

/** @internal What the `marketStatus()` plugin gives the chart. */
export interface MarketStatusFeature {
  /** The market phase now and its next change (`marketPhase`). */
  phase: typeof marketPhase;
  /** The legend badge text for `status`; `session` false (a market that never closes) leaves the phase out. */
  badge(status: MarketStatus & { delay: number | 'eod' }, text: Localizer, session: boolean): string;
}

/** @internal The `marketStatus()` plugin's part. */
export const marketStatusFeature: MarketStatusFeature = {
  phase: marketPhase,
  badge(status, text, session) {
    const parts: string[] = [];
    // A market that never closes has no phase worth showing.
    if (session) parts.push(text.text(PHASE_LABELS[status.phase]));
    if (status.delay === 'eod') parts.push(text.text('marketEndOfDay'));
    else if (status.delay > 0) parts.push(text.text('marketDelayed', { minutes: status.delay }));
    return parts.join(' · ');
  },
};
