import { withAlpha, type Primitive } from '@chart-on/core';

/**
 * Shades intraday bars outside [startHour, endHour) UTC. A small example of a
 * primitive written only against the public API: it draws below the series
 * and needs no redraws of its own, since it only depends on the view.
 */
export function offHoursShading(startHour: number, endHour: number): Primitive {
  return {
    layer: 'below',
    drawPlot(ctx, env) {
      const { times } = env;
      // Daily and longer bars have no hours to shade.
      if (times.length < 2 || times[times.length - 1]! - times[times.length - 2]! >= 86400) return;
      const outside = (i: number) => {
        const hour = new Date(times[i]! * 1000).getUTCHours();
        return hour < startHour || hour >= endHour;
      };
      const a = Math.max(0, Math.floor(env.from));
      const b = Math.min(times.length - 1, Math.ceil(env.to));
      const half = env.barSpacing / 2;
      ctx.fillStyle = withAlpha(env.theme.textMuted, 0.08);
      let start = -1;
      for (let i = a; i <= b + 1; i++) {
        const out = i <= b && outside(i);
        if (out && start < 0) start = i;
        if (!out && start >= 0) {
          const x0 = env.indexToX(start) - half;
          ctx.fillRect(x0, 0, env.indexToX(i - 1) + half - x0, env.height);
          start = -1;
        }
      }
    },
  };
}
