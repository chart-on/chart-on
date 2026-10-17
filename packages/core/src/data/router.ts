import { ChartError, errorText } from '../errors';
import { devWarn, isDev } from '../util/dev';
import type { DataSource, FeedStatus, SymbolInfo } from './types';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** One feed behind a data source router. */
export interface DataSourceRoute {
  source: DataSource;
  /**
   * Shown as the `exchange` of the feed's symbols and offered by the
   * router's exchange filter; defaults to the route's prefix.
   */
  name?: string;
}

/** Options for `createDataSourceRouter`: the prefix separator, the route for unprefixed symbols, and a handler for failed route searches. */
export interface DataSourceRouterOptions {
  /** Between a route's prefix and the feed's symbol (default `':'`). Only the first one splits. */
  separator?: string;
  /**
   * Prefix of the route that answers symbols without a known prefix; without
   * it they fail to resolve. Their resolved symbols carry the prefix.
   */
  defaultRoute?: string;
  /**
   * Hears about a route whose symbol search failed; the other routes'
   * results are still returned. Without it, development builds log a
   * `search-route-failed` warning, once per route.
   */
  onError?(error: unknown, route: { prefix: string; name: string }): void;
}

/** A data source over several feeds, plus the exchange filter for a symbol search dialog. */
export interface DataSourceRouter extends DataSource {
  /**
   * Searches every route, or only one: the route whose prefix starts the
   * query (`'FEED-A:abc'`), or the route named by `request.exchange`.
   */
  search(query: string, request?: { exchange?: string }): Promise<SymbolInfo[]>;
  /** One exchange filter option per route, its name as value and label, in route order. */
  readonly searchFilters: { exchanges: { value: string; label: string }[] };
}

interface Route {
  prefix: string;
  name: string;
  source: DataSource;
  /** Live bar subscriptions open through the router. */
  active: number;
}

interface Target {
  route: Route;
  /** The feed's own symbol info, or symbol before it is resolved. */
  info: SymbolInfo;
}

/**
 * One data source over several feeds, chosen by a prefix on the chart's
 * symbols: with routes `{ 'FEED-A': { source: a }, 'FEED-B': { source: b } }`
 * the symbol `'FEED-A:BTC/USD'` is `'BTC/USD'` on `a`. Symbols split at the
 * first separator only, so feed symbols may contain it. Resolved and searched
 * symbols come back prefixed, with `exchange` set to the route's name; `a`
 * gets its own symbol info back in `history` and the other calls.
 *
 * Search queries every route and merges the results in route order; a failed
 * route is reported to `onError` and left out, and the search rejects only
 * when every route failed. Each route's connection status is passed on while
 * the route has live bars open, or while no route has; its resets carry the
 * routed symbol. Quotes, adjustments, markers
 * and server time go to the routed source when it supports them; the router
 * has each optional method that at least one route has.
 */
export function createDataSourceRouter(
  routes: Readonly<Record<string, DataSourceRoute>>,
  options: DataSourceRouterOptions = {},
): DataSourceRouter {
  const separator = options.separator ?? ':';
  if (separator === '') throw new TypeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'createDataSourceRouter: the separator must not be empty' : '');
  const table = new Map<string, Route>();
  for (const [prefix, route] of Object.entries(routes)) {
    if (prefix === '' || prefix.includes(separator)) {
      throw new TypeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `createDataSourceRouter: route prefix "${prefix}" must be non-empty and free of "${separator}"` : '');
    }
    table.set(prefix, { prefix, name: route.name ?? prefix, source: route.source, active: 0 });
  }
  const list = [...table.values()];
  let fallback: Route | null = null;
  if (options.defaultRoute !== undefined) {
    fallback = table.get(options.defaultRoute) ?? null;
    if (!fallback) throw new TypeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `createDataSourceRouter: no route "${options.defaultRoute}" for defaultRoute` : '');
  }

  /** Feed symbol info by routed symbol, from `symbol`. */
  const resolved = new Map<string, Target>();

  /** The route of a chart symbol and the feed's symbol, or null. */
  const locate = (symbol: string): { route: Route; rest: string } | null => {
    const at = symbol.indexOf(separator);
    const route = at > 0 ? table.get(symbol.slice(0, at)) : undefined;
    if (route) return { route, rest: symbol.slice(at + separator.length) };
    return fallback ? { route: fallback, rest: symbol } : null;
  };

  const unknown = (symbol: string) =>
    new ChartError('unknown-symbol', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `No data source route for "${symbol}"` : '', {
      context: { symbol, prefixes: [...table.keys()] },
    });

  /** The feed and its symbol info for a routed symbol info. */
  const target = (info: SymbolInfo): Target => {
    const known = resolved.get(info.symbol);
    if (known) return known;
    // Not resolved through this router (e.g. restored from storage): strip the prefix.
    const found = locate(info.symbol);
    if (!found) throw unknown(info.symbol);
    return { route: found.route, info: { ...info, symbol: found.rest } };
  };

  const routed = (route: Route, info: SymbolInfo): SymbolInfo => ({
    ...info,
    symbol: `${route.prefix}${separator}${info.symbol}`,
    exchange: route.name,
  });

  /** Routes whose search failure was logged already: once each, as the dialog searches per keystroke. */
  const warned = new Set<Route>();
  const report = (error: unknown, route: Route) => {
    if (options.onError) return options.onError(error, { prefix: route.prefix, name: route.name });
    if (warned.has(route)) return;
    warned.add(route);
    if (/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production') devWarn(`symbol search of route "${route.prefix}" failed: ${errorText(error)}`, 'search-route-failed');
  };

  const router: DataSourceRouter = {
    searchFilters: { exchanges: list.map((route) => ({ value: route.name, label: route.name })) },

    async symbol(symbol) {
      const found = locate(symbol);
      if (!found) throw unknown(symbol);
      const info = await found.route.source.symbol(found.rest);
      const out = routed(found.route, info);
      resolved.set(out.symbol, { route: found.route, info });
      return out;
    },

    async search(query, request = {}) {
      let text = query;
      let targets = list;
      const at = query.indexOf(separator);
      const typed = at > 0 ? query.slice(0, at).toLowerCase() : null;
      const prefixed = typed === null ? undefined : list.find((route) => route.prefix.toLowerCase() === typed);
      if (prefixed) {
        targets = [prefixed];
        text = query.slice(at + separator.length);
      }
      if (request.exchange) {
        const named = targets.filter((route) => route.name === request.exchange);
        if (named.length > 0) targets = named;
      }
      const results = await Promise.allSettled(
        targets.map(async (route) => {
          const found = await route.source.search(text);
          if (!Array.isArray(found)) throw new TypeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'search did not return an array' : '');
          return found.map((info) => routed(route, info));
        }),
      );
      const merged: SymbolInfo[] = [];
      let failures = 0;
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          merged.push(...result.value);
          return;
        }
        failures++;
        report(result.reason, targets[i]!);
      });
      // Every route failed: the dialog shows an error instead of no results.
      if (failures > 0 && failures === results.length) throw (results[0] as PromiseRejectedResult).reason;
      return merged;
    },

    async history(symbol, interval, request) {
      const { route, info } = target(symbol);
      return route.source.history(info, interval, request);
    },
  };

  if (list.some((route) => route.source.stream)) {
    router.stream = (symbol, interval, onBar) => {
      const { route, info } = target(symbol);
      if (!route.source.stream) return () => {};
      route.active++;
      let unsubscribe: () => void;
      try {
        unsubscribe = route.source.stream(info, interval, onBar);
      } catch (error) {
        route.active--;
        throw error;
      }
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        // Counted down first, so the status the feed reports on closing is judged without it.
        route.active--;
        unsubscribe();
      };
    };
  }

  if (list.some((route) => route.source.onStatus)) {
    router.onStatus = (listener) => {
      const passes = (route: Route) => route.active > 0 || list.every((r) => r.active === 0);
      const stops = list.map((route) =>
        route.source.onStatus?.((status: FeedStatus) => {
          if (passes(route)) listener(status);
        }),
      );
      return () => {
        for (const stop of stops) stop?.();
      };
    };
  }

  if (list.some((route) => route.source.onReset)) {
    // A feed names its own symbols; the chart knows them by their routed names.
    router.onReset = (listener) => {
      const stops = list.map((route) =>
        route.source.onReset?.((reset) => listener({ ...reset, symbol: `${route.prefix}${separator}${reset.symbol}` })),
      );
      return () => {
        for (const stop of stops) stop?.();
      };
    };
  }

  if (list.some((route) => route.source.quotes)) {
    router.quotes = (symbol, onQuote) => {
      const { route, info } = target(symbol);
      return route.source.quotes?.(info, onQuote) ?? (() => {});
    };
  }

  if (list.some((route) => route.source.adjustments)) {
    router.adjustments = async (symbol, request) => {
      const { route, info } = target(symbol);
      return route.source.adjustments ? route.source.adjustments(info, request) : [];
    };
  }

  if (list.some((route) => route.source.markers)) {
    router.markers = async (symbol, interval, request) => {
      const { route, info } = target(symbol);
      return route.source.markers ? route.source.markers(info, interval, request) : [];
    };
  }

  const clock = fallback?.source.now ? fallback : list.find((route) => route.source.now);
  if (clock) router.now = () => clock.source.now!();

  return router;
}

