// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { useCurlMode } from '../curl/useCurlMode';
import { deriveSpreadGeometry } from '../curl/spreadGeometry';
import { FlipbookContext, type FlipbookContextValue } from '../core/FlipbookContext';
import { PageRegistryReadContext, type PageRegistryRead, createPageRegistry } from '../core/PageRegistry';
import { createInitialState } from '../core/flipbookReducer';
import { computeSpreads } from '../core/computeSpreads';
import type { PageSource } from '../types/PageSource';

function makeStubSource(pageCount = 10): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => pageCount,
    getPageSize: () => ({ width: 600, height: 800 }),
    renderPage: () => Promise.resolve(document.createElement('canvas')),
    dispose: () => {},
  };
}

function buildContext(opts: { pageCount?: number; currentSpreadIndex?: number; resolvedViewMode?: 'single' | 'dual-cover'; source?: PageSource } = {}): FlipbookContextValue {
  const pageCount = opts.pageCount ?? 10;
  const resolvedViewMode = opts.resolvedViewMode ?? 'dual-cover';
  const source = opts.source ?? makeStubSource(pageCount);
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
  return { state, dispatch: vi.fn(), source, spreads, effectiveScale: 1, isOverflowing: false, registerCurlWheelHandler: vi.fn(), registerCurlNavHandler: vi.fn(), sourceStatus: 'ready', sourceError: null, showLinks: true };
}

function Wrapper({ ctxValue, registry, children }: { ctxValue: FlipbookContextValue; registry: PageRegistryRead; children: ReactNode }) {
  return (
    <FlipbookContext.Provider value={ctxValue}>
      <PageRegistryReadContext.Provider value={registry}>
        {children}
      </PageRegistryReadContext.Provider>
    </FlipbookContext.Provider>
  );
}

function useTestHarness(params: { enabled: boolean; ctxValue: FlipbookContextValue; registryRead: PageRegistryRead; registryVersion: number }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const spreadGeometry = deriveSpreadGeometry(params.ctxValue.spreads, params.ctxValue.state.currentSpreadIndex);
  return useCurlMode({
    enabled: params.enabled,
    stageRef,
    overlayRef,
    overlayRect: null,
    spreadGeometry,
    registryRead: params.registryRead,
    registryVersion: params.registryVersion,
  });
}

describe('useCurlMode — orchestrator', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getCancelSignal returns 0 on initial mount', () => {
    const ctxValue = buildContext();
    const { read } = createPageRegistry();
    const { result } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );
    expect(result.current.getCancelSignal()).toBe(0);
  });

  // Stateful-wrapper pattern note (used by the source-change and viewMode-change tests):
  //
  // @testing-library/react's `renderHook` passes `initialProps` ONLY to the hook callback,
  // NOT to the wrapper (wrappers receive `{children}`). To re-render with a different
  // FlipbookContext value, both the hook callback AND the wrapper must read from the
  // SAME mutable cell (a `let` binding). Calling `rerender()` re-runs the callback AND
  // re-renders the wrapper; both then read the latest value from the let binding.

  it('increments cancelSignal when source identity changes', () => {
    let currentCtxValue: FlipbookContextValue = buildContext({ source: makeStubSource() });
    const { read } = createPageRegistry();

    const { result, rerender } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue: currentCtxValue, registryRead: read, registryVersion: 0 }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Wrapper ctxValue={currentCtxValue} registry={read}>{children}</Wrapper>
        ),
      },
    );

    expect(result.current.getCancelSignal()).toBe(0);

    currentCtxValue = buildContext({ source: makeStubSource() });
    act(() => rerender());

    expect(result.current.getCancelSignal()).toBeGreaterThan(0);
  });

  it('increments cancelSignal when resolvedViewMode changes', () => {
    let currentCtxValue: FlipbookContextValue = buildContext({ resolvedViewMode: 'dual-cover' });
    const { read } = createPageRegistry();

    const { result, rerender } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue: currentCtxValue, registryRead: read, registryVersion: 0 }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Wrapper ctxValue={currentCtxValue} registry={read}>{children}</Wrapper>
        ),
      },
    );

    expect(result.current.getCancelSignal()).toBe(0);

    currentCtxValue = buildContext({ resolvedViewMode: 'single' });
    act(() => rerender());

    expect(result.current.getCancelSignal()).toBeGreaterThan(0);
  });

  it('increments cancelSignal on enabled true→false transition', () => {
    const ctxValue = buildContext();
    const { read } = createPageRegistry();

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useTestHarness({ enabled, ctxValue, registryRead: read, registryVersion: 0 }),
      {
        wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper>,
        initialProps: { enabled: true },
      },
    );

    expect(result.current.getCancelSignal()).toBe(0);

    act(() => rerender({ enabled: false }));

    expect(result.current.getCancelSignal()).toBeGreaterThan(0);
  });

  it('does NOT increment cancelSignal on enabled false→true transition', () => {
    const ctxValue = buildContext();
    const { read } = createPageRegistry();

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useTestHarness({ enabled, ctxValue, registryRead: read, registryVersion: 0 }),
      {
        wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper>,
        initialProps: { enabled: false },
      },
    );

    expect(result.current.getCancelSignal()).toBe(0);

    act(() => rerender({ enabled: true }));

    expect(result.current.getCancelSignal()).toBe(0);
  });

  it('registers and removes visibilitychange listener on mount/unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const ctxValue = buildContext();
    const { read } = createPageRegistry();
    const { unmount } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );

    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('bumps cancelSignal when document.visibilityState flips to hidden', () => {
    let visibilityState: 'visible' | 'hidden' = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilityState });

    const ctxValue = buildContext();
    const { read } = createPageRegistry();
    const { result } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );

    const before = result.current.getCancelSignal();

    visibilityState = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.getCancelSignal()).toBeGreaterThan(before);
  });
});

describe('useCurlMode — wheel handler registration', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a curl wheel handler on mount when enabled=true', () => {
    const ctxValue = buildContext({});
    const { read } = createPageRegistry();
    renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );
    expect(ctxValue.registerCurlWheelHandler).toHaveBeenCalledTimes(1);
    expect(ctxValue.registerCurlWheelHandler).toHaveBeenCalledWith(expect.any(Function));
  });

  it('unregisters on cleanup (passes null)', () => {
    const ctxValue = buildContext({});
    const { read } = createPageRegistry();
    const { unmount } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );
    (ctxValue.registerCurlWheelHandler as ReturnType<typeof vi.fn>).mockClear();
    unmount();
    expect(ctxValue.registerCurlWheelHandler).toHaveBeenCalledWith(null);
  });

  it('does NOT register when enabled=false', () => {
    const ctxValue = buildContext({});
    const { read } = createPageRegistry();
    renderHook(
      () => useTestHarness({ enabled: false, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );
    expect(ctxValue.registerCurlWheelHandler).not.toHaveBeenCalled();
  });

  it('registered handler delegates to decideCurlWheelDispatch and fires startAnimatedCurl on fire:true', () => {
    const ctxValue = buildContext({});
    const registry = createPageRegistry();
    // Pre-populate the registry with bitmap entries for all pages — satisfies
    // the nextBitmapReady gate inside useCurlMode's wheel handler so decision.fire
    // can be true.
    for (let i = 0; i < 10; i++) {
      registry.write.register(i, {
        canvas: document.createElement('canvas'),
        element: document.createElement('div'),
      });
    }
    const { result } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: registry.read, registryVersion: 1 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={registry.read}>{children}</Wrapper> },
    );

    const registerMock = ctxValue.registerCurlWheelHandler as ReturnType<typeof vi.fn>;
    const captured = registerMock.mock.calls[0][0] as (d: 'next' | 'previous') => void;
    expect(typeof captured).toBe('function');

    const startSpy = vi.spyOn(result.current.actions, 'startAnimatedCurl').mockImplementation(() => true);

    captured('next');
    expect(startSpy).toHaveBeenCalledWith('next');
  });

  it('registered handler respects animating gate (delegated to decideCurlWheelDispatch)', () => {
    const ctxValue = buildContext({});
    const { read } = createPageRegistry();
    const { result } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );
    const registerMock = ctxValue.registerCurlWheelHandler as ReturnType<typeof vi.fn>;
    const captured = registerMock.mock.calls[0][0] as (d: 'next' | 'previous') => void;

    vi.spyOn(result.current.actions, 'isAnimating').mockReturnValue(true);
    const startSpy = vi.spyOn(result.current.actions, 'startAnimatedCurl').mockImplementation(() => true);

    captured('next');
    expect(startSpy).not.toHaveBeenCalled();
  });

  // --- Programmatic-nav handler (arrows / keyboard / next()/previous()) ---

  it('registers a curl nav handler on mount when enabled=true', () => {
    const ctxValue = buildContext({});
    const { read } = createPageRegistry();
    renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );
    expect(ctxValue.registerCurlNavHandler).toHaveBeenCalledTimes(1);
    expect(ctxValue.registerCurlNavHandler).toHaveBeenCalledWith(expect.any(Function));
  });

  it('nav handler unregisters on cleanup (passes null)', () => {
    const ctxValue = buildContext({});
    const { read } = createPageRegistry();
    const { unmount } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );
    (ctxValue.registerCurlNavHandler as ReturnType<typeof vi.fn>).mockClear();
    unmount();
    expect(ctxValue.registerCurlNavHandler).toHaveBeenCalledWith(null);
  });

  it('does NOT register a nav handler when enabled=false', () => {
    const ctxValue = buildContext({});
    const { read } = createPageRegistry();
    renderHook(
      () => useTestHarness({ enabled: false, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );
    expect(ctxValue.registerCurlNavHandler).not.toHaveBeenCalled();
  });

  it('nav handler curls (returns true + fires startAnimatedCurl) when the target bitmap is ready', () => {
    const ctxValue = buildContext({});
    const registry = createPageRegistry();
    for (let i = 0; i < 10; i++) {
      registry.write.register(i, {
        canvas: document.createElement('canvas'),
        element: document.createElement('div'),
      });
    }
    const { result } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: registry.read, registryVersion: 1 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={registry.read}>{children}</Wrapper> },
    );
    const registerMock = ctxValue.registerCurlNavHandler as ReturnType<typeof vi.fn>;
    const captured = registerMock.mock.calls[0][0] as (d: 'next' | 'previous') => boolean;
    const startSpy = vi.spyOn(result.current.actions, 'startAnimatedCurl').mockImplementation(() => true);

    expect(captured('next')).toBe(true);
    expect(startSpy).toHaveBeenCalledWith('next');
  });

  it('nav handler snaps (returns false, no curl) when the target bitmap is NOT ready', () => {
    const ctxValue = buildContext({});
    const { read } = createPageRegistry(); // empty → bitmap not ready
    const { result } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper> },
    );
    const registerMock = ctxValue.registerCurlNavHandler as ReturnType<typeof vi.fn>;
    const captured = registerMock.mock.calls[0][0] as (d: 'next' | 'previous') => boolean;
    const startSpy = vi.spyOn(result.current.actions, 'startAnimatedCurl').mockImplementation(() => true);

    expect(captured('next')).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('nav handler ignores (returns true, no curl) while a curl is animating', () => {
    const ctxValue = buildContext({});
    const registry = createPageRegistry();
    for (let i = 0; i < 10; i++) {
      registry.write.register(i, {
        canvas: document.createElement('canvas'),
        element: document.createElement('div'),
      });
    }
    const { result } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: registry.read, registryVersion: 1 }),
      { wrapper: ({ children }) => <Wrapper ctxValue={ctxValue} registry={registry.read}>{children}</Wrapper> },
    );
    const registerMock = ctxValue.registerCurlNavHandler as ReturnType<typeof vi.fn>;
    const captured = registerMock.mock.calls[0][0] as (d: 'next' | 'previous') => boolean;
    vi.spyOn(result.current.actions, 'isAnimating').mockReturnValue(true);
    const startSpy = vi.spyOn(result.current.actions, 'startAnimatedCurl').mockImplementation(() => true);

    expect(captured('next')).toBe(true);
    expect(startSpy).not.toHaveBeenCalled();
  });
});

describe('useCurlMode — cancellation on effectiveScale change', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('effectiveScale change while enabled bumps cancelSignal + calls actions.cancel', () => {
    let ctxValue: FlipbookContextValue = { ...buildContext({}), effectiveScale: 1 };
    const { read } = createPageRegistry();
    const Wrap = ({ children }: { children: ReactNode }) => (
      <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper>
    );
    const { result, rerender } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: Wrap },
    );

    const cancelSpy = vi.spyOn(result.current.actions, 'cancel');
    const signalBefore = result.current.getCancelSignal();

    ctxValue = { ...ctxValue, effectiveScale: 1.5 };
    rerender();

    expect(result.current.getCancelSignal()).toBeGreaterThan(signalBefore);
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('effectiveScale change while disabled still bumps (dep array does not gate on enabled)', () => {
    let ctxValue: FlipbookContextValue = { ...buildContext({}), effectiveScale: 1 };
    const { read } = createPageRegistry();
    const Wrap = ({ children }: { children: ReactNode }) => (
      <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper>
    );
    const { result, rerender } = renderHook(
      () => useTestHarness({ enabled: false, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: Wrap },
    );

    const cancelSpy = vi.spyOn(result.current.actions, 'cancel');
    const signalBefore = result.current.getCancelSignal();

    ctxValue = { ...ctxValue, effectiveScale: 2 };
    rerender();

    expect(result.current.getCancelSignal()).toBeGreaterThan(signalBefore);
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('no-change rerender does NOT bump (effectiveScale path stable when value unchanged)', () => {
    let ctxValue: FlipbookContextValue = { ...buildContext({}), effectiveScale: 1 };
    const { read } = createPageRegistry();
    const Wrap = ({ children }: { children: ReactNode }) => (
      <Wrapper ctxValue={ctxValue} registry={read}>{children}</Wrapper>
    );
    const { result, rerender } = renderHook(
      () => useTestHarness({ enabled: true, ctxValue, registryRead: read, registryVersion: 0 }),
      { wrapper: Wrap },
    );

    const signalAfterMount = result.current.getCancelSignal();
    // Re-render with the SAME effectiveScale — proves the effectiveScale path
    // itself doesn't fire when prev === current.
    ctxValue = { ...ctxValue, effectiveScale: 1 };
    rerender();

    expect(result.current.getCancelSignal()).toBe(signalAfterMount);
  });
});
