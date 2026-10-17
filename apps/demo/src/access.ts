import type { Chart } from '@charton/core';

/** How long a notice stays up (ms). */
const NOTICE_MS = 4000;

/**
 * A short notice over the chart when the access rules refuse something: the
 * demo's stand-in for the upgrade prompt an app would show.
 */
export function showAccessNotices(chart: Chart, stage: HTMLElement): () => void {
  injectStyle();
  const notice = document.createElement('p');
  notice.className = 'demo-access-notice';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  stage.append(notice);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = (text: string) => {
    notice.textContent = text;
    notice.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => (notice.hidden = true), NOTICE_MS);
  };
  const labelOf = (tool: string) => chart.drawings.getTools().find((t) => t.type === tool)?.label ?? tool;

  const offs = [
    chart.on('tool:refuse', ({ tool }) => show(`${labelOf(tool)} is a premium tool in this demo.`)),
    chart.on('indicator:refuse', ({ reason }) => {
      if (reason === 'limit') show(`This demo allows ${chart.indicators.limit} indicators. Remove one to add another.`);
      else show('That indicator is not available in this demo.');
    }),
  ];
  return () => {
    clearTimeout(timer);
    offs.forEach((off) => off());
    notice.remove();
  };
}

function injectStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .pc-stage > .demo-access-notice {
      position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 5; margin: 0;
      padding: 6px 12px; border-radius: var(--pc-radius-lg); font-size: 12px; pointer-events: none;
      background: var(--pc-popover); color: var(--pc-ink); box-shadow: var(--pc-shadow), inset 0 0 0 1px var(--pc-line);
    }
    .demo-access-notice[hidden] { display: none; }
  `;
  document.head.append(style);
}
