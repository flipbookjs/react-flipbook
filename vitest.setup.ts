import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Polyfills required for pdfjs-dist and PageRenderer in Node/jsdom (Week 0 findings)

// jsdom doesn't implement matchMedia — PageRenderer uses it for mobile DPR cap
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
}

if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { return Object.create(DOMMatrix.prototype); }
  } as any;
}

if (typeof globalThis.DOMPoint === 'undefined') {
  globalThis.DOMPoint = class DOMPoint {
    constructor(
      public x = 0,
      public y = 0,
      public z = 0,
      public w = 1,
    ) {}
  } as any;
}

if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {
    constructor() { return Object.create(Path2D.prototype); }
  } as any;
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  const resizeObserverInstances: any[] = [];
  (globalThis as any).__resizeObservers = resizeObserverInstances;

  globalThis.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      resizeObserverInstances.push(this);
    }
    observe() {
      // Auto-fire with default dimensions so the ready gate opens in tests
      // without requiring manual resize simulation. Real ResizeObserver fires
      // synchronously on first observe() too (before next paint).
      this.callback(
        [{ contentRect: { width: 1024, height: 768 } } as unknown as ResizeObserverEntry],
        this,
      );
    }
    unobserve() {}
    disconnect() {}
    // Test helper: simulate a resize to specific dimensions
    _fireResize(width: number, height: number) {
      this.callback(
        [{ contentRect: { width, height } } as unknown as ResizeObserverEntry],
        this,
      );
    }
  } as any;
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {
      // No-op default. Tests that need to drive intersection state
      // (the useThumbnailVirtualization tests) override
      // `globalThis.IntersectionObserver` per-file with a controllable
      // mock, saving + restoring this polyfill in beforeEach/afterEach.
    }
    observe(_target: Element) {}
    unobserve(_target: Element) {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: ReadonlyArray<number> = [];
  } as unknown as typeof IntersectionObserver;
}
