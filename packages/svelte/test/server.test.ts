import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ServerPage from './fixtures/ServerPage.svelte';

/** Server rendering: no DOM, no WebGL, and no chart, only the container element. */

/** The markup without the framework's hydration comments. */
function markup(html: string): string {
  return html.replace(/<!--[^>]*-->/g, '');
}

describe('server rendering', () => {
  it('renders <Chart> as its container without creating a chart', () => {
    const { body } = render(ServerPage);
    expect(markup(body)).toBe('<div id="price" class="chart" style="height: 300px"><span>null null</span></div>');
    // Creating a chart would have needed `document`, which a server does not have.
    expect(typeof document).toBe('undefined');
  });

  it('renders <ChartShell> as its container without creating a shell', () => {
    const { body } = render(ServerPage, { props: { shell: true } });
    expect(markup(body)).toBe('<div class="shell"><span>null null</span></div>');
  });
});
