// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { FlipbookProvider } from '../FlipbookProvider';
import type { PageSource } from '../types/PageSource';

function makeStubSource(pageCount = 6): PageSource {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 800;
  return {
    init: () => Promise.resolve(),
    getPageCount: () => pageCount,
    getPageSize: () => ({ width: 600, height: 800 }),
    renderPage: () => Promise.resolve(canvas),
    dispose: () => {},
  };
}

class StubResizeObserver {
  callback: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.callback = cb; }
  observe(target: Element): void {
    setTimeout(() => {
      this.callback(
        [{
          target,
          contentRect: new DOMRect(0, 0, 1024, 800),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }, 0);
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  (global as typeof globalThis).ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
});

describe('FlipbookProvider — conditional CurlOverlay mount', () => {
  it('does NOT mount CurlOverlay when enablePageCurl=false (default)', async () => {
    const source = makeStubSource();
    const { container } = render(
      <FlipbookProvider source={source} viewMode="dual-cover" />,
    );

    await waitFor(() => expect(container.querySelector('.fbjs-stage')).not.toBeNull());
    expect(container.querySelector('.fbjs-curl-overlay')).toBeNull();
  });

  it('mounts CurlOverlay after pages register when enablePageCurl=true', async () => {
    const source = makeStubSource();
    const { container } = render(
      <FlipbookProvider source={source} viewMode="dual-cover" enablePageCurl />,
    );

    await waitFor(() => expect(container.querySelector('.fbjs-stage')).not.toBeNull());

    await waitFor(
      () => expect(container.querySelector('.fbjs-curl-overlay')).not.toBeNull(),
      { timeout: 2000 },
    );
  });

  it('mounts CurlOverlay in single-page view mode (curl active in single + dual)', async () => {
    const source = makeStubSource();
    const { container } = render(
      <FlipbookProvider source={source} viewMode="single" enablePageCurl />,
    );

    await waitFor(() => expect(container.querySelector('.fbjs-stage')).not.toBeNull());
    await waitFor(
      () => expect(container.querySelector('.fbjs-curl-overlay')).not.toBeNull(),
      { timeout: 2000 },
    );
  });

  it('does NOT mount CurlOverlay until showContent is true', async () => {
    const source = makeStubSource();
    const { container } = render(
      <FlipbookProvider source={source} viewMode="dual-cover" enablePageCurl />,
    );

    expect(container.querySelector('.fbjs-stage')).toBeNull();
    expect(container.querySelector('.fbjs-curl-overlay')).toBeNull();

    await waitFor(() => expect(container.querySelector('.fbjs-stage')).not.toBeNull());
  });

  it('unmounts CurlOverlay when enablePageCurl flips false', async () => {
    const source = makeStubSource();
    const { container, rerender } = render(
      <FlipbookProvider source={source} viewMode="dual-cover" enablePageCurl />,
    );

    await waitFor(
      () => expect(container.querySelector('.fbjs-curl-overlay')).not.toBeNull(),
      { timeout: 2000 },
    );

    act(() => {
      rerender(<FlipbookProvider source={source} viewMode="dual-cover" enablePageCurl={false} />);
    });

    expect(container.querySelector('.fbjs-curl-overlay')).toBeNull();
  });

  it('PageRegistry contexts present even when curl is disabled', async () => {
    const source = makeStubSource();
    const { container } = render(
      <FlipbookProvider source={source} viewMode="dual-cover" />, // enablePageCurl=false
    );

    await waitFor(() => expect(container.querySelector('.fbjs-stage')).not.toBeNull());
    expect(container.querySelector('.fbjs-spread')).not.toBeNull();
  });
});
