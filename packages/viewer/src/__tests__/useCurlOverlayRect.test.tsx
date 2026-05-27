// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useCurlOverlayRect } from '../curl/useCurlOverlayRect';
import { createPageRegistry } from '../core/PageRegistry';
import type { SpreadGeometry } from '../curl/spreadGeometry';

function makeGeometry(overrides: Partial<SpreadGeometry> = {}): SpreadGeometry {
  return {
    currentPages: [],
    nextPages: [],
    previousPages: [],
    currentSoloShape: null,
    nextSoloShape: null,
    previousSoloShape: null,
    ...overrides,
  };
}

function makePage(left: number, top: number, w: number, h: number): { canvas: HTMLCanvasElement; element: HTMLDivElement } {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => new DOMRect(left, top, w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = h * 2;
  return { canvas, element };
}

function harness(opts: { geometry: SpreadGeometry; resolvedViewMode?: 'single' | 'dual-cover'; stageRect?: DOMRect; registerPages?: Array<[number, ReturnType<typeof makePage>]>; registryVersion?: number }) {
  const registry = createPageRegistry();
  const stage = document.createElement('div');
  stage.getBoundingClientRect = () => opts.stageRect ?? new DOMRect(0, 0, 1024, 800);
  if (opts.registerPages) {
    for (const [idx, entry] of opts.registerPages) registry.write.register(idx, entry);
  }

  const { result } = renderHook(() => {
    const stageRef = useRef<HTMLDivElement | null>(stage);
    return useCurlOverlayRect({
      stageRef,
      spreadGeometry: opts.geometry,
      registryRead: registry.read,
      registryVersion: opts.registryVersion ?? 0,
      resolvedViewMode: opts.resolvedViewMode ?? 'dual-cover',
    });
  });

  return { result };
}

describe('useCurlOverlayRect — measurement', () => {
  it('returns null when current spread has no pages', () => {
    const { result } = harness({ geometry: makeGeometry({ currentPages: [] }) });
    expect(result.current).toBeNull();
  });

  it('returns null when current spread pages are not in the registry', () => {
    const { result } = harness({ geometry: makeGeometry({ currentPages: [1, 2] }) });
    expect(result.current).toBeNull();
  });

  it('returns union rect of registered current-spread pages in stage-local coords', () => {
    const { result } = harness({
      geometry: makeGeometry({ currentPages: [1, 2] }),
      registerPages: [
        [1, makePage(100, 100, 600, 800)],
        [2, makePage(700, 100, 600, 800)],
      ],
    });

    expect(result.current).not.toBeNull();
    expect(result.current!.left).toBe(100);
    expect(result.current!.top).toBe(100);
    expect(result.current!.width).toBe(1200);
    expect(result.current!.height).toBe(800);
  });

  it('expands rect leftward by current width for cover spread (dual-cover)', () => {
    const { result } = harness({
      geometry: makeGeometry({
        currentPages: [0],
        currentSoloShape: 'cover',
      }),
      registerPages: [
        [0, makePage(500, 100, 600, 800)],
      ],
    });

    expect(result.current!.left).toBe(-100); // 500 - 600
    expect(result.current!.width).toBe(1200); // 600 × 2
  });

  it('expands rect rightward by current width for last-solo spread (dual-cover)', () => {
    const { result } = harness({
      geometry: makeGeometry({
        currentPages: [5],
        currentSoloShape: 'last-solo',
      }),
      registerPages: [
        [5, makePage(100, 100, 600, 800)],
      ],
    });

    expect(result.current!.left).toBe(100);
    expect(result.current!.width).toBe(1200);
  });

  it('does NOT expand rect in single view mode', () => {
    const { result } = harness({
      geometry: makeGeometry({
        currentPages: [3],
        currentSoloShape: 'cover',
      }),
      registerPages: [
        [3, makePage(100, 100, 600, 800)],
      ],
      resolvedViewMode: 'single',
    });

    expect(result.current!.width).toBe(600);
  });

  it('viewportRect equals union page rect plus stage origin', () => {
    const { result } = harness({
      geometry: makeGeometry({ currentPages: [1, 2] }),
      stageRect: new DOMRect(50, 50, 1024, 800),
      registerPages: [
        [1, makePage(150, 150, 600, 800)],
        [2, makePage(750, 150, 600, 800)],
      ],
    });

    expect(result.current!.left).toBe(100); // 150 - 50
    expect(result.current!.viewportRect.left).toBe(150);
    expect(result.current!.viewportRect.width).toBe(1200);
  });

  it('re-measures when ResizeObserver fires', () => {
    // Capture the ResizeObserver callback so we can fire it manually.
    let observerCallback: ResizeObserverCallback | null = null;
    class CaptureObserver {
      constructor(cb: ResizeObserverCallback) { observerCallback = cb; }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    const originalRO = (global as typeof globalThis).ResizeObserver;
    (global as typeof globalThis).ResizeObserver = CaptureObserver as unknown as typeof ResizeObserver;

    try {
      const registry = createPageRegistry();
      const stage = document.createElement('div');
      stage.getBoundingClientRect = () => new DOMRect(0, 0, 1024, 800);
      registry.write.register(1, makePage(100, 100, 600, 800));
      registry.write.register(2, makePage(700, 100, 600, 800));

      const geometry = makeGeometry({ currentPages: [1, 2] });

      const { result } = renderHook(() => {
        const stageRef = useRef<HTMLDivElement | null>(stage);
        return useCurlOverlayRect({
          stageRef,
          spreadGeometry: geometry,
          registryRead: registry.read,
          registryVersion: 1,
          resolvedViewMode: 'dual-cover',
        });
      });

      expect(result.current?.width).toBe(1200);
      expect(observerCallback).not.toBeNull();

      // Simulate a stage resize by changing the registered page rects, then firing
      // the captured ResizeObserver callback. The hook should re-measure.
      registry.write.unregister(1);
      registry.write.unregister(2);
      registry.write.register(1, makePage(100, 100, 400, 600));
      registry.write.register(2, makePage(500, 100, 400, 600));

      act(() => {
        observerCallback!(
          [{
            target: stage,
            contentRect: new DOMRect(0, 0, 1024, 800),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as unknown as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });

      expect(result.current?.width).toBe(800); // 400 + 400
    } finally {
      (global as typeof globalThis).ResizeObserver = originalRO;
    }
  });
});
