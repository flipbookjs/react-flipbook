// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { useRef } from 'react';
import CurlOverlay from '../curl/CurlOverlay';
import { FlipbookContext, type FlipbookContextValue } from '../core/FlipbookContext';
import { PageRegistryReadContext, type PageRegistryRead, createPageRegistry } from '../core/PageRegistry';
import { createInitialState } from '../core/flipbookReducer';
import { computeSpreads } from '../core/computeSpreads';
import type { PageSource } from '../types/PageSource';

function makeStubSource(pageCount = 6): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => pageCount,
    getPageSize: () => ({ width: 600, height: 800 }),
    renderPage: () => Promise.resolve(document.createElement('canvas')),
    dispose: () => {},
  };
}

function buildContext(opts: { pageCount?: number; currentSpreadIndex?: number; resolvedViewMode?: 'single' | 'dual-cover' } = {}): FlipbookContextValue {
  const pageCount = opts.pageCount ?? 6;
  const resolvedViewMode = opts.resolvedViewMode ?? 'dual-cover';
  const source = makeStubSource(pageCount);
  const state = {
    ...createInitialState('dual-cover'),
    pageCount,
    resolvedViewMode,
    currentSpreadIndex: opts.currentSpreadIndex ?? 1,
    containerWidth: 1024,
    containerHeight: 800,
  };
  const spreads = computeSpreads(pageCount, resolvedViewMode);
  state.spreadCount = spreads.length;
  return { state, dispatch: vi.fn(), source, spreads, effectiveScale: 1 };
}

function makePageEntry(left: number): { canvas: HTMLCanvasElement; element: HTMLDivElement } {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => new DOMRect(left, 100, 600, 800);
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1600;
  return { canvas, element };
}

function Harness({ ctxValue, registry }: { ctxValue: FlipbookContextValue; registry: PageRegistryRead }) {
  const stageRef = useRef<HTMLDivElement>(null);
  if (stageRef.current && !(stageRef.current as unknown as { __mocked?: true }).__mocked) {
    (stageRef.current as unknown as { __mocked: true }).__mocked = true;
    stageRef.current.getBoundingClientRect = () => new DOMRect(0, 0, 1024, 800);
  }
  return (
    <FlipbookContext.Provider value={ctxValue}>
      <PageRegistryReadContext.Provider value={registry}>
        <div ref={stageRef} className="fbjs-stage" style={{ width: 1024, height: 800 }}>
          <CurlOverlay stageRef={stageRef} />
        </div>
      </PageRegistryReadContext.Provider>
    </FlipbookContext.Provider>
  );
}

/**
 * jsdom doesn't ship a real Canvas 2D context. Without this stub, every CurlOverlay
 * mount would trip the degraded-mode warning (getContext returns null), polluting
 * non-degraded tests with console output and exercising the wrong code path. See
 * useCurlRenderCallback.test.tsx for the helper's contract.
 */
function installCanvas2DStub(): void {
  const contextCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    kind: string,
  ) {
    if (kind !== '2d') return null;
    let ctx = contextCache.get(this);
    if (!ctx) {
      ctx = {
        setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
        save: vi.fn(), restore: vi.fn(), translate: vi.fn(),
        rotate: vi.fn(), scale: vi.fn(), beginPath: vi.fn(),
        moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
        fill: vi.fn(), stroke: vi.fn(), clip: vi.fn(), arc: vi.fn(),
        quadraticCurveTo: vi.fn(), bezierCurveTo: vi.fn(),
        fillRect: vi.fn(), strokeRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      } as unknown as CanvasRenderingContext2D;
      contextCache.set(this, ctx);
    }
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
}

describe('CurlOverlay — integration', () => {
  beforeEach(() => {
    installCanvas2DStub();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders null when no pages are registered', () => {
    const ctxValue = buildContext();
    const { read } = createPageRegistry();
    const { container } = render(<Harness ctxValue={ctxValue} registry={read} />);
    expect(container.querySelector('.fbjs-curl-overlay')).toBeNull();
  });

  it('renders canvas with DPR-scaled backing store after pages register', async () => {
    const ctxValue = buildContext({ pageCount: 6, currentSpreadIndex: 1 });
    const registry = createPageRegistry();
    const { container } = render(<Harness ctxValue={ctxValue} registry={registry.read} />);

    act(() => {
      registry.write.register(1, makePageEntry(100));
      registry.write.register(2, makePageEntry(700));
    });

    const overlay = await waitFor(() => {
      const el = container.querySelector('.fbjs-curl-overlay');
      expect(el).not.toBeNull();
      return el as HTMLCanvasElement;
    });

    expect(overlay.width).toBe(2400);  // 1200 CSS × DPR 2
    expect(overlay.height).toBe(1600); //  800 CSS × DPR 2
    expect(overlay.style.width).toBe('1200px');
    expect(overlay.style.height).toBe('800px');
  });

  it('data-active is absent during idle state', async () => {
    const ctxValue = buildContext({ pageCount: 6, currentSpreadIndex: 1 });
    const registry = createPageRegistry();
    const { container } = render(<Harness ctxValue={ctxValue} registry={registry.read} />);

    act(() => {
      registry.write.register(1, makePageEntry(100));
      registry.write.register(2, makePageEntry(700));
    });

    const overlay = await waitFor(() => container.querySelector('.fbjs-curl-overlay') as HTMLCanvasElement);
    expect(overlay.getAttribute('data-active')).toBeNull();
  });

  it('logs dev warning and continues to render when getContext returns null', async () => {
    // Override the canvas stub installed by beforeEach: force getContext to return null
    // so we exercise the degraded path. vi.restoreAllMocks() in afterEach restores both
    // this spy and the stub installed by beforeEach.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ctxValue = buildContext({ pageCount: 6, currentSpreadIndex: 1 });
    const registry = createPageRegistry();
    const { container } = render(<Harness ctxValue={ctxValue} registry={registry.read} />);

    act(() => {
      registry.write.register(1, makePageEntry(100));
      registry.write.register(2, makePageEntry(700));
    });

    await waitFor(() => {
      expect(container.querySelector('.fbjs-curl-overlay')).not.toBeNull();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CurlOverlay canvas context unavailable'),
    );
  });

  it('subscribes to PageRegistry via useSyncExternalStore', async () => {
    const ctxValue = buildContext({ pageCount: 6, currentSpreadIndex: 1 });
    const registry = createPageRegistry();
    const subscribeSpy = vi.spyOn(registry.read, 'subscribe');

    render(<Harness ctxValue={ctxValue} registry={registry.read} />);

    await waitFor(() => expect(subscribeSpy).toHaveBeenCalled());
  });

  it('unmounts cleanly without errors', async () => {
    const ctxValue = buildContext({ pageCount: 6, currentSpreadIndex: 1 });
    const registry = createPageRegistry();
    const { unmount } = render(<Harness ctxValue={ctxValue} registry={registry.read} />);
    expect(() => unmount()).not.toThrow();
  });
});
