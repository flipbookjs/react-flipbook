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
  return { state, dispatch: vi.fn(), source, spreads, effectiveScale: 1, isOverflowing: false };
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
