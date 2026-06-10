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

describe('Flipbook SSR safety — thumbnails', () => {
  it('SSR output does NOT include the panel (useIsMounted gate active)', () => {
    const source = makeSource();
    const html = renderToString(<Flipbook source={source} />);
    expect(html).not.toContain('fbjs-thumbnail-panel');
    expect(html).not.toContain(LABELS.thumbnailPanelLabel);
  });

  it('SSR output does NOT include the toggle button (useIsMounted gate via Toolbar)', () => {
    const source = makeSource();
    const html = renderToString(<Flipbook source={source} />);
    expect(html).not.toContain('fbjs-thumbnails-toggle-button');
    expect(html).not.toContain(LABELS.thumbnailsToggle);
  });
});
