import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThumbnailVirtualization } from '../thumbnails/useThumbnailVirtualization';

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

let lastCallback: IntersectionCallback | null = null;
let observedTargets: Element[] = [];
let originalIntersectionObserver: typeof IntersectionObserver | undefined;

class MockIntersectionObserver {
  constructor(callback: IntersectionCallback) {
    lastCallback = callback;
  }
  observe(target: Element) {
    observedTargets.push(target);
  }
  unobserve(target: Element) {
    observedTargets = observedTargets.filter((t) => t !== target);
  }
  disconnect() {
    observedTargets = [];
  }
}

beforeEach(() => {
  lastCallback = null;
  observedTargets = [];
  // Save the no-op polyfill installed by vitest.setup.ts before replacing
  // it with the controllable mock. Restoring it in afterEach (instead of
  // `delete`) keeps later test files functional.
  originalIntersectionObserver = (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = MockIntersectionObserver;
});

afterEach(() => {
  if (originalIntersectionObserver !== undefined) {
    (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver = originalIntersectionObserver;
  } else {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  }
});

function makeEntry(target: Element, intersecting: boolean): IntersectionObserverEntry {
  return { target, isIntersecting: intersecting } as IntersectionObserverEntry;
}

describe('useThumbnailVirtualization', () => {
  it('returns initial range { start: 0, end: 0 }', () => {
    const root = document.createElement('div');
    const { result } = renderHook(() =>
      useThumbnailVirtualization({
        pageCount: 0,
        scrollRoot: root,
        itemSelector: 'button',
      }),
    );
    expect(result.current.visibleRange).toEqual({ start: 0, end: 0 });
  });

  it('updates range when an item enters intersection', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    // Pre-populate 5 buttons with data-page-index.
    for (let i = 0; i < 5; i++) {
      const btn = document.createElement('button');
      btn.dataset.pageIndex = String(i);
      root.appendChild(btn);
    }
    const { result } = renderHook(() =>
      useThumbnailVirtualization({
        pageCount: 5,
        scrollRoot: root,
        itemSelector: '[data-page-index]',
        overscan: 1,
      }),
    );
    act(() => {
      lastCallback!([makeEntry(root.children[2], true)]);
    });
    expect(result.current.visibleRange.start).toBe(1);   // 2 - overscan 1
    expect(result.current.visibleRange.end).toBe(4);     // 2 + overscan 1 + 1 (exclusive)
    document.body.removeChild(root);
  });

  it('overscan defaults to 5', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    for (let i = 0; i < 20; i++) {
      const btn = document.createElement('button');
      btn.dataset.pageIndex = String(i);
      root.appendChild(btn);
    }
    const { result } = renderHook(() =>
      useThumbnailVirtualization({
        pageCount: 20,
        scrollRoot: root,
        itemSelector: '[data-page-index]',
      }),
    );
    act(() => {
      lastCallback!([makeEntry(root.children[10], true)]);
    });
    expect(result.current.visibleRange.start).toBe(5);   // 10 - 5
    expect(result.current.visibleRange.end).toBe(16);    // 10 + 5 + 1
    document.body.removeChild(root);
  });

  it('clamps start to 0 and end to pageCount', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    for (let i = 0; i < 3; i++) {
      const btn = document.createElement('button');
      btn.dataset.pageIndex = String(i);
      root.appendChild(btn);
    }
    const { result } = renderHook(() =>
      useThumbnailVirtualization({
        pageCount: 3,
        scrollRoot: root,
        itemSelector: '[data-page-index]',
        overscan: 10,
      }),
    );
    act(() => {
      lastCallback!([makeEntry(root.children[1], true)]);
    });
    expect(result.current.visibleRange.start).toBe(0);
    expect(result.current.visibleRange.end).toBe(3);
    document.body.removeChild(root);
  });
});
