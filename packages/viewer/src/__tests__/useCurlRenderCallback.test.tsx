// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useCurlRenderCallback } from '../curl/useCurlRenderCallback';
import { createPageRegistry } from '../core/PageRegistry';
import type { CurlAnimationActions, CurlAnimationSnapshot } from '../curl/useCurlAnimation';
import type { CurlResult } from '../curl/CurlCalculation';
import type { SpreadGeometry } from '../curl/spreadGeometry';
import type { OverlayRect } from '../curl/useCurlOverlayRect';

/**
 * jsdom doesn't ship a real Canvas 2D context (the `canvas` npm package isn't in
 * deps — verified at `dev/react-flipbook/package.json`). Without this stub,
 * `canvas.getContext('2d')` returns null, and any spy on `ctx.translate` etc.
 * throws "cannot read property of null".
 *
 * The stub returns the SAME context object per canvas instance (WeakMap-cached),
 * so a test can grab the context once and assert on its spies across multiple
 * calls from inside the hook. Returns a partial CanvasRenderingContext2D —
 * only the methods used by CurlRenderer + the idle-spine path.
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
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        clip: vi.fn(),
        arc: vi.fn(),
        quadraticCurveTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      } as unknown as CanvasRenderingContext2D;
      contextCache.set(this, ctx);
    }
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
}

function makeActions(): CurlAnimationActions & { setRenderCallback: ReturnType<typeof vi.fn> } {
  return {
    startDrag: vi.fn(),
    updateDrag: vi.fn(),
    endDrag: vi.fn(),
    startAnimatedCurl: vi.fn(),
    startHover: vi.fn(),
    endHover: vi.fn(),
    cancel: vi.fn(),
    isAnimating: () => false,
    // Typed signature required so the intersection type's setRenderCallback
    // signature is satisfied (untyped vi.fn() returns Mock<Procedure | Constructable>
    // which doesn't unify with the (fn: ...) => void signature). Matches 3A's
    // typed-vi.fn convention.
    setRenderCallback: vi.fn<(fn: ((curl: CurlResult, direction: 'next' | 'previous') => void) | null) => void>(),
  };
}

function makeGeometry(): SpreadGeometry {
  return {
    currentPages: [1, 2],
    nextPages: [3, 4],
    previousPages: [0],
    currentSoloShape: null,
    nextSoloShape: null,
    previousSoloShape: null,
  };
}

function makeOverlayRect(): OverlayRect {
  return {
    left: 100,
    top: 100,
    width: 1200,
    height: 800,
    viewportRect: new DOMRect(100, 100, 1200, 800),
  };
}

function makeSnapshot(state: CurlAnimationSnapshot['state'] = 'idle', committed = false): CurlAnimationSnapshot {
  return { state, direction: 'next', committed };
}

function harness(opts: { actions: CurlAnimationActions; snapshot?: CurlAnimationSnapshot; overlayRect?: OverlayRect | null; degraded?: boolean }) {
  const registry = createPageRegistry();
  return renderHook(() => {
    const stageRef = useRef<HTMLDivElement | null>(document.createElement('div'));
    const overlayRef = useRef<HTMLCanvasElement | null>(document.createElement('canvas'));
    useCurlRenderCallback({
      stageRef,
      overlayRef,
      actions: opts.actions,
      snapshot: opts.snapshot ?? makeSnapshot(),
      overlayRect: opts.overlayRect ?? makeOverlayRect(),
      spreadGeometry: makeGeometry(),
      registryRead: registry.read,
      resolvedViewMode: 'dual-cover',
      degraded: opts.degraded ?? false,
    });
  });
}

describe('useCurlRenderCallback', () => {
  beforeEach(() => {
    installCanvas2DStub();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a render callback on mount', () => {
    const actions = makeActions();
    harness({ actions });
    expect(actions.setRenderCallback).toHaveBeenCalledWith(expect.any(Function));
  });

  it('unregisters the render callback on unmount', () => {
    const actions = makeActions();
    const { unmount } = harness({ actions });
    actions.setRenderCallback.mockClear();
    unmount();
    expect(actions.setRenderCallback).toHaveBeenCalledWith(null);
  });

  it('does NOT register a render callback when degraded=true', () => {
    const actions = makeActions();
    harness({ actions, degraded: true });
    expect(actions.setRenderCallback).not.toHaveBeenCalledWith(expect.any(Function));
  });

  it('unregisters when degraded flips true after initial registration', () => {
    const actions = makeActions();
    const { rerender } = renderHook(
      ({ degraded }: { degraded: boolean }) => {
        const stageRef = useRef<HTMLDivElement | null>(document.createElement('div'));
        const overlayRef = useRef<HTMLCanvasElement | null>(document.createElement('canvas'));
        const registry = createPageRegistry();
        useCurlRenderCallback({
          stageRef,
          overlayRef,
          actions,
          snapshot: makeSnapshot(),
          overlayRect: makeOverlayRect(),
          spreadGeometry: makeGeometry(),
          registryRead: registry.read,
          resolvedViewMode: 'dual-cover',
          degraded,
        });
      },
      { initialProps: { degraded: false } },
    );

    expect(actions.setRenderCallback).toHaveBeenLastCalledWith(expect.any(Function));

    rerender({ degraded: true });
    expect(actions.setRenderCallback).toHaveBeenLastCalledWith(null);
  });

  it('paints idle-state spine shadow when idle, not committed, in dual-cover', () => {
    const actions = makeActions();
    const overlayCanvas = document.createElement('canvas');
    const ctx2d = overlayCanvas.getContext('2d') as CanvasRenderingContext2D;
    // ctx2d.translate is already a vi.fn() from installCanvas2DStub — assert directly.

    renderHook(() => {
      const stageRef = useRef<HTMLDivElement | null>(document.createElement('div'));
      const overlayRef = useRef<HTMLCanvasElement | null>(overlayCanvas);
      const registry = createPageRegistry();
      useCurlRenderCallback({
        stageRef,
        overlayRef,
        actions,
        snapshot: makeSnapshot('idle', false),
        overlayRect: makeOverlayRect(),
        spreadGeometry: makeGeometry(),
        registryRead: registry.read,
        resolvedViewMode: 'dual-cover',
        degraded: false,
      });
    });

    // drawSpineShadow calls ctx.translate(width/2, 0) — observable via the stub's vi.fn().
    expect(ctx2d.translate).toHaveBeenCalled();
  });

  it('does NOT paint idle-spine when state is idle but committed (commit just finished)', () => {
    const actions = makeActions();
    const overlayCanvas = document.createElement('canvas');
    const ctx2d = overlayCanvas.getContext('2d') as CanvasRenderingContext2D;

    renderHook(() => {
      const stageRef = useRef<HTMLDivElement | null>(document.createElement('div'));
      const overlayRef = useRef<HTMLCanvasElement | null>(overlayCanvas);
      const registry = createPageRegistry();
      useCurlRenderCallback({
        stageRef,
        overlayRef,
        actions,
        snapshot: makeSnapshot('idle', true),
        overlayRect: makeOverlayRect(),
        spreadGeometry: makeGeometry(),
        registryRead: registry.read,
        resolvedViewMode: 'dual-cover',
        degraded: false,
      });
    });

    expect(ctx2d.translate).not.toHaveBeenCalled();
  });

  it('catches throws inside the render closure and cancels the animation (Decision 14)', () => {
    // Verifies the try/catch added per Decision 14 — "renderCurlFrame() throws: caught;
    // animation cancels; logged in dev mode". Without this guard, a throw from any canvas
    // operation in the closure would escape the rAF call to window.onerror, and the next
    // rAF tick would re-throw, producing a tight error loop until cancelSignal happens
    // to bump from another source.
    //
    // Test strategy: force the first canvas method in the closure (setTransform) to
    // throw by re-implementing the stub. Manually invoke the registered renderFrame
    // (jsdom doesn't drive rAF), then assert the catch path fired both branches:
    // dev console.error AND actions.cancel().
    const actions = makeActions();
    const overlayCanvas = document.createElement('canvas');
    const ctx2d = overlayCanvas.getContext('2d') as CanvasRenderingContext2D;

    // setTransform is the first canvas op after the null guards; throwing here
    // reliably enters the catch without depending on later code paths.
    (ctx2d.setTransform as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('synthetic 2D context failure');
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => {
      const stageRef = useRef<HTMLDivElement | null>(document.createElement('div'));
      const overlayRef = useRef<HTMLCanvasElement | null>(overlayCanvas);
      const registry = createPageRegistry();
      useCurlRenderCallback({
        stageRef,
        overlayRef,
        actions,
        // 'animating' skips the idle-spine useLayoutEffect (which would ALSO call
        // setTransform and throw before we get to the manually-invoked callback).
        snapshot: makeSnapshot('animating'),
        overlayRect: makeOverlayRect(),
        spreadGeometry: makeGeometry(),
        registryRead: registry.read,
        resolvedViewMode: 'dual-cover',
        degraded: false,
      });
    });

    // Grab the renderFrame that useCurlRenderCallback registered via actions.setRenderCallback.
    const renderFrame = (actions.setRenderCallback as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(renderFrame).toBeDefined();

    // Invoke directly — synthetic CurlResult is fine because setTransform throws
    // before any curl-data fields are accessed.
    renderFrame({} as never, 'next');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('curl render frame threw'),
      expect.any(Error),
    );
    expect(actions.cancel).toHaveBeenCalled();
  });
});
