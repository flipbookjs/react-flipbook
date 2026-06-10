// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Flipbook } from '../Flipbook';
import { LABELS } from '../toolbar/labels';
import type { PageSource } from '../types/PageSource';

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(),
    dispose: () => {},
  };
}

describe('Flipbook SSR safety + isMounted gate', () => {
  it('renderToString of <Flipbook> does not throw', () => {
    const source = makeSource();
    expect(() => renderToString(<Flipbook source={source} />)).not.toThrow();
  });

  it('SSR output includes .fbjs-root with data-theme (NOT tabindex — root is not focusable)', () => {
    const source = makeSource();
    const html = renderToString(<Flipbook source={source} initialTheme="dark" />);
    expect(html).toContain('class="fbjs-root"');
    expect(html).toContain('data-theme="dark"');
    // Existing .fbjs-container still has tabindex="0" from 6A — verify it's
    // present somewhere in the output (one tab stop, on container) but NOT on
    // .fbjs-root.
    expect(html).toMatch(/class="fbjs-container"[^>]*tabindex="0"/);
    expect(html).not.toMatch(/class="fbjs-root"[^>]*tabindex/);
  });

  it('SSR output does NOT include toolbar buttons (useIsMounted gate active)', () => {
    const source = makeSource();
    const html = renderToString(<Flipbook source={source} title="Doc" />);
    expect(html).not.toContain('role="toolbar"');
    expect(html).not.toContain(LABELS.toolbarTopBarLabel);
    expect(html).not.toContain(LABELS.toolbarBottomBarLabel);
    expect(html).not.toContain('data-testid="fbjs-prev-button"');
    expect(html).not.toContain('data-testid="fbjs-theme-toggle-button"');
  });

  it('SSR output omits title text (top bar contents gated by isMounted)', () => {
    const source = makeSource();
    const html = renderToString(<Flipbook source={source} title="My Document" />);
    expect(html).not.toContain('My Document');
  });

  it('SSR output with toolbar={false} matches the gated-built-in shape (no toolbar markers)', () => {
    const source = makeSource();
    const html = renderToString(<Flipbook source={source} toolbar={false} title="Hidden" />);
    expect(html).not.toContain('role="toolbar"');
    expect(html).toContain('class="fbjs-root"');
  });

  it('SSR output with toolbar={<CustomBar/>} renders the consumer JSX (bypasses gate)', () => {
    const source = makeSource();
    const CustomBar = () => <div data-testid="custom">My custom SSR toolbar</div>;
    const html = renderToString(<Flipbook source={source} toolbar={<CustomBar />} />);
    expect(html).toContain('My custom SSR toolbar');
    expect(html).toContain('data-testid="custom"');
  });

  it('SSR output with toolbar={{ top, bottom }} slot object renders BOTH consumer nodes', () => {
    const source = makeSource();
    const html = renderToString(
      <Flipbook
        source={source}
        toolbar={{
          top: <div data-testid="ssr-top">SSR Top Bar Content</div>,
          bottom: <div data-testid="ssr-bottom">SSR Bottom Bar Content</div>,
        }}
      />,
    );
    // Both consumer slots render in SSR HTML (bypasses isMounted gate; same as
    // the single-ReactNode variant — slot object is a consumer-dictated render).
    expect(html).toContain('SSR Top Bar Content');
    expect(html).toContain('SSR Bottom Bar Content');
    expect(html).toContain('data-testid="ssr-top"');
    expect(html).toContain('data-testid="ssr-bottom"');
    // No built-in toolbar markers — the consumer JSX replaces both built-in slots.
    expect(html).not.toContain('role="toolbar"');
    expect(html).not.toContain(LABELS.toolbarTopBarLabel);
    expect(html).not.toContain(LABELS.toolbarBottomBarLabel);
  });

  it('SSR output with toolbar={{ top }} omits the bottom slot (consumer slot is partial)', () => {
    const source = makeSource();
    const html = renderToString(
      <Flipbook
        source={source}
        toolbar={{ top: <div data-testid="ssr-only-top">Top only</div> }}
      />,
    );
    expect(html).toContain('Top only');
    expect(html).toContain('data-testid="ssr-only-top"');
    // Bottom is null → no consumer marker for it.
    expect(html).not.toContain('data-testid="ssr-only-bottom"');
    // No built-in toolbars (slot object is still custom).
    expect(html).not.toContain('role="toolbar"');
  });
});
