import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { FlipbookProvider } from '../FlipbookProvider';
import type { PageSource } from '../types/PageSource';

// SSR plumbing for the public `children` prop on FlipbookProvider.
//
// Scope note: `<Flipbook>` itself is documented client-only (see MIGRATION.md
// §13.1 — canvas + window APIs). The hooks (useFlipbook / useFlipbookSelector
// / useFlipbookActions) are SSR-safe via the provider's frozen-sentinel
// `getServerSnapshot` path (MIGRATION.md §13.3). This test verifies that
// `children` plumb through the SSR-safe layer at FlipbookProvider:1089
// (rendered inside all contexts but outside `.fbjs-container`).
//
// Effect-host children (e.g., the §7.2 <ThemeSyncer>) DON'T dispatch in SSR
// — useEffect doesn't run server-side. This test only guards the marker
// plumbing.

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

describe('FlipbookProvider children — SSR plumbing', () => {
  it('renders children in SSR output without throwing', () => {
    const html = renderToString(
      <FlipbookProvider source={makeSource()}>
        <span data-marker="ssr-child">ssr</span>
      </FlipbookProvider>,
    );
    expect(html).toContain('data-marker="ssr-child"');
  });

  it('multiple children all appear in SSR output', () => {
    const html = renderToString(
      <FlipbookProvider source={makeSource()}>
        <span data-marker="child-a">A</span>
        <span data-marker="child-b">B</span>
        <span data-marker="child-c">C</span>
      </FlipbookProvider>,
    );
    expect(html).toContain('data-marker="child-a"');
    expect(html).toContain('data-marker="child-b"');
    expect(html).toContain('data-marker="child-c"');
  });

  it('omitted children — SSR pass still succeeds (no JSX child)', () => {
    const html = renderToString(<FlipbookProvider source={makeSource()} />);
    // Provider's root div is rendered server-side; we don't assert specific
    // chrome content (the loading state varies), only that the call doesn't
    // throw and produces non-empty markup.
    expect(html.length).toBeGreaterThan(0);
  });
});
