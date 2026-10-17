import { FILLS, TradeFills } from '../src/annotations/fills';
import { AnnotationManager, type AnnotationHost } from '../src/annotations/manager';
import { LINES, TradingLines } from '../src/annotations/trading-lines';

/** An annotation manager with the layers the `trading()` plugin adds: order, position, alert and draft lines, and fills. */
export function tradingManager(host: AnnotationHost): AnnotationManager {
  const manager = new AnnotationManager(host);
  manager.addLayer(LINES, (h) => new TradingLines(h));
  manager.addLayer(FILLS, (h) => new TradeFills(h));
  return manager;
}

/** The trading lines layer of a manager from `tradingManager`, for tests that read its layout. */
export function lines(manager: AnnotationManager): TradingLines {
  return (manager as unknown as { layers: Map<string, TradingLines> }).layers.get(LINES)!;
}
