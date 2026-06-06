import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FlipbookProvider } from '../FlipbookProvider';
import {
  useFlipbook,
  SSR_HOOK,
  SSR_ACTIONS,
  SSR_HELPERS,
  type FlipbookHook,
} from '../hooks/useFlipbook';
import type { PageSource } from '../types/PageSource';

function makeSource(opts: { pageCount?: number; fail?: boolean } = {}): PageSource {
  return {
    init: opts.fail
      ? () => Promise.reject(new Error('test failure'))
      : () => Promise.resolve(),
    getPageCount: () => opts.pageCount ?? 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

/**
 * A source whose init() is controllable from the test body. Returns the source
 * plus a `resolve` callback the test calls to settle init. Use this when the
 * test needs to observe the `loading` state — the auto-resolving `makeSource()`
 * settles via microtask before testing-library's `act()` returns, so by the
 * time a synchronous `expect(status).toBe('loading')` runs, status is already
 * `'ready'`. The controllable promise pattern holds the source in `loading`
 * until the test explicitly resolves it.
 */
function makeControllableSource(opts: { pageCount?: number } = {}): {
  source: PageSource;
  resolveInit: () => void;
  rejectInit: (err: Error) => void;
} {
  // Create the promise eagerly so the resolve/reject handles are populated
  // BEFORE the return. A "lazy" version that creates the promise inside
  // init() would return undefined handles (init() hasn't run yet at
  // destructure time). usePageSource calls init() once per source — so a
  // single eager promise is the right shape.
  let resolveInit!: () => void;
  let rejectInit!: (err: Error) => void;
  const initPromise = new Promise<void>((resolve, reject) => {
    resolveInit = resolve;
    rejectInit = reject;
  });
  const source: PageSource = {
    init: () => initPromise,
    getPageCount: () => opts.pageCount ?? 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
  return { source, resolveInit, rejectInit };
}

const wrap = (source: PageSource) => ({ children }: { children: ReactNode }) =>
  <FlipbookProvider source={source}>{children}</FlipbookProvider>;

describe('useFlipbook() — discriminated union shape', () => {
  it('throws outside FlipbookProvider', () => {
    expect(() => renderHook(() => useFlipbook())).toThrow();
  });

  it('client-side loading returns a per-snapshot identity-stable result (NOT SSR_HOOK)', async () => {
    // SSR_HOOK is ONLY returned for the true SSR pass (when the snapshot IS SSR_SNAPSHOT
    // identity, via getServerSnapshot). Client-side live loading reads the LIVE snapshot,
    // which has the actual `initialTheme` from the reducer — so substituting SSR_HOOK
    // here would erase user-seeded state. The hook builds a fresh per-snapshot result
    // via useMemo so identity is still stable across renders.
    //
    // Uses controllable init so loading state is observable (auto-resolving init
    // would settle via microtask before our assertions run).
    const { source } = makeControllableSource();
    const { result, rerender } = renderHook(() => useFlipbook(), { wrapper: wrap(source) });
    const fb1 = result.current as FlipbookHook;
    expect(fb1.status).toBe('loading');
    expect(fb1).not.toBe(SSR_HOOK);                     // live-loading is NOT the SSR sentinel
    rerender();
    const fb2 = result.current as FlipbookHook;
    expect(fb2).toBe(fb1);                              // identity-stable across renders (useMemo)
    // The live snapshot's actions/helpers are the provider's real (memoized) instances,
    // NOT the SSR_ACTIONS / SSR_HELPERS constants.
    expect(fb2.actions).not.toBe(SSR_ACTIONS);
    expect(fb2.helpers).not.toBe(SSR_HELPERS);
  });

  it('preserves initialTheme in loading state', () => {
    // Regression test: if the loading-path returned SSR_HOOK, fb.state.theme
    // would always be 'light' regardless of initialTheme. The live-snapshot
    // read fixes this. Uses controllable init so loading state is observable.
    const { source } = makeControllableSource();
    const wrapper = ({ children }: { children: ReactNode }) =>
      <FlipbookProvider source={source} initialTheme="dark">{children}</FlipbookProvider>;
    const { result } = renderHook(() => useFlipbook(), { wrapper });
    expect(result.current.status).toBe('loading');
    expect(result.current.state.theme).toBe('dark');    // preserved from initialTheme prop
  });

  it('transitions to ready, narrows source, and reflects totalPages', async () => {
    // Combined waitFor: source.init() resolving sets sourceState to 'ready', and
    // a SEPARATE useLayoutEffect in the provider then dispatches SOURCE_CHANGED
    // to populate totalPages. The two transitions are not simultaneous — we
    // wait for BOTH conditions in a single waitFor block so we don't race.
    const { source, resolveInit } = makeControllableSource({ pageCount: 4 });
    const { result } = renderHook(() => useFlipbook(), { wrapper: wrap(source) });
    expect(result.current.status).toBe('loading');

    act(() => { resolveInit(); });
    await vi.waitFor(() => {
      expect(result.current.status).toBe('ready');
      expect(result.current.state.totalPages).toBe(4);
    });

    const fb = result.current;
    expect(fb.status).toBe('ready');
    expect(fb.error).toBeNull();
    expect(fb.source).toBe(source);   // narrowed to non-null on ready
  });

  it('transitions to error and surfaces the Error (NOT SSR_HOOK)', async () => {
    const { source, rejectInit } = makeControllableSource();
    const { result } = renderHook(() => useFlipbook(), { wrapper: wrap(source) });
    expect(result.current.status).toBe('loading');

    act(() => { rejectInit(new Error('test failure')); });
    await vi.waitFor(() => expect(result.current.status).toBe('error'));

    const fb = result.current;
    expect(fb.status).toBe('error');
    expect(fb.error).toBeInstanceOf(Error);
    expect(fb.error?.message).toBe('test failure');
    expect(fb.source).toBeNull();
    expect(fb).not.toBe(SSR_HOOK);   // error path NEVER substitutes SSR_HOOK
  });
});

describe('useFlipbook() — action stability across url change', () => {
  it('dispatch-only actions are referentially stable; download/print rotate on source change', async () => {
    const sourceA = makeSource({ pageCount: 4 });
    const sourceB = makeSource({ pageCount: 6 });

    // `renderHook`'s `wrapper` prop receives only `children` — initialProps go to the
    // callback. To swap the source between renders, we use a closure variable that the
    // wrapper reads on every render and the test mutates between rerender() calls.
    let currentSource: PageSource = sourceA;
    const wrapper = ({ children }: { children: ReactNode }) =>
      <FlipbookProvider source={currentSource}>{children}</FlipbookProvider>;

    const { result, rerender } = renderHook(() => useFlipbook(), { wrapper });
    // Combined waitFor: status flips to 'ready' BEFORE SOURCE_CHANGED commits, so
    // wait for both conditions atomically (same race as the 'transitions to ready'
    // test above).
    await vi.waitFor(() => {
      expect(result.current.status).toBe('ready');
      expect(result.current.state.totalPages).toBe(4);
    });
    const a = result.current.actions;
    const a_helpers = result.current.helpers;
    const a_pageToSpreadIndex = result.current.helpers.pageToSpreadIndex;

    currentSource = sourceB;
    rerender();
    await vi.waitFor(() => expect(result.current.state.totalPages).toBe(6));
    const b = result.current.actions;

    // Dispatch-only: STABLE across the source change (refs in the provider absorb
    // state/derived-value changes; the callbacks themselves stay [dispatch]-stable).
    expect(b.next).toBe(a.next);
    expect(b.previous).toBe(a.previous);
    expect(b.goToFirst).toBe(a.goToFirst);
    expect(b.goToLast).toBe(a.goToLast);                // verifies the ref-mirror fix
    expect(b.goToPage).toBe(a.goToPage);                // verifies the ref-mirror fix
    expect(b.zoomIn).toBe(a.zoomIn);
    expect(b.zoomOut).toBe(a.zoomOut);
    expect(b.setZoom).toBe(a.setZoom);
    expect(b.fitPage).toBe(a.fitPage);
    expect(b.fitWidth).toBe(a.fitWidth);
    expect(b.enterFullScreen).toBe(a.enterFullScreen);
    expect(b.exitFullScreen).toBe(a.exitFullScreen);
    expect(b.toggleFullScreen).toBe(a.toggleFullScreen);
    expect(b.setTheme).toBe(a.setTheme);
    expect(b.toggleTheme).toBe(a.toggleTheme);
    expect(b.setInteractionMode).toBe(a.setInteractionMode);
    expect(b.setThumbnailsOpen).toBe(a.setThumbnailsOpen);
    expect(b.toggleThumbnails).toBe(a.toggleThumbnails);

    // Source-bound: ROTATED — print/download close over `source` per Decision 1.
    expect(b.print).not.toBe(a.print);
    expect(b.download).not.toBe(a.download);

    // Helpers object identity: STABLE across source change. The provider's
    // helpers useMemo has deps `[canFullScreen]` (Phase 5.3 — narrowed after
    // the ref refactor); `canFullScreen` doesn't change between sourceA and
    // sourceB (it's a `typeof document` capability flag, not source-derived).
    // This catches accidental dep-array expansions in future sub-plans that
    // would silently break React.memo'd helpers consumers.
    expect(result.current.helpers).toBe(a_helpers);                    // helpers obj identity
    expect(result.current.helpers.pageToSpreadIndex).toBe(a_pageToSpreadIndex);  // member identity
  });

  it('goToPage uses the LATEST pageCount/spreads via the provider refs (not stale closure)', async () => {
    // After source change, goToPage(5) should be valid against sourceB's 6 pages
    // (would have been invalid against sourceA's 4 pages). If the implementation
    // accidentally closed over state.pageCount, this would no-op + warn.
    const sourceA = makeSource({ pageCount: 4 });
    const sourceB = makeSource({ pageCount: 6 });
    let currentSource: PageSource = sourceA;
    const wrapper = ({ children }: { children: ReactNode }) =>
      <FlipbookProvider source={currentSource}>{children}</FlipbookProvider>;

    const { result, rerender } = renderHook(() => useFlipbook(), { wrapper });
    await vi.waitFor(() => expect(result.current.state.totalPages).toBe(4));

    currentSource = sourceB;
    rerender();
    await vi.waitFor(() => expect(result.current.state.totalPages).toBe(6));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    result.current.actions.goToPage(5);
    // Should NOT warn — page 5 is valid for the new 6-page document.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('helpers.pageToSpreadIndex — 1-indexed contract', () => {
  it('returns -1 for invalid inputs', async () => {
    const source = makeSource({ pageCount: 10 });
    const { result } = renderHook(() => useFlipbook(), { wrapper: wrap(source) });
    await vi.waitFor(() => expect(result.current.status).toBe('ready'));
    const { pageToSpreadIndex } = result.current.helpers;

    expect(pageToSpreadIndex(0)).toBe(-1);            // 0 invalid (1-indexed)
    expect(pageToSpreadIndex(11)).toBe(-1);           // > totalPages
    expect(pageToSpreadIndex(NaN)).toBe(-1);
    expect(pageToSpreadIndex(3.5)).toBe(-1);          // non-integer
    expect(pageToSpreadIndex(Infinity)).toBe(-1);
    expect(pageToSpreadIndex(-1)).toBe(-1);
  });

  it('returns valid spread index for valid pageNumber', async () => {
    const source = makeSource({ pageCount: 10 });
    const { result } = renderHook(() => useFlipbook(), { wrapper: wrap(source) });
    await vi.waitFor(() => expect(result.current.status).toBe('ready'));
    const { pageToSpreadIndex } = result.current.helpers;

    // Single-page mode (default for narrow container): page N → spread N-1
    expect(pageToSpreadIndex(1)).toBeGreaterThanOrEqual(0);
    expect(pageToSpreadIndex(10)).toBeGreaterThanOrEqual(0);
  });
});

describe('actions.goToPage — 1-indexed contract + OOB no-op', () => {
  it('is a no-op for invalid inputs (no spreadIndex change)', async () => {
    // goToPage(invalid) fires a one-shot devWarn → console.warn.
    // Vitest's NODE_ENV is 'test' (not 'production'), so devWarn is NOT a
    // no-op — the warning prints. Silence it so the test output stays clean
    // AND so this test passes under any future "no console output during
    // tests" CI gate. The one-shot pattern means only the first invalid call
    // logs; later ones are silent regardless.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const source = makeSource({ pageCount: 10 });
    const { result } = renderHook(() => useFlipbook(), { wrapper: wrap(source) });
    await vi.waitFor(() => expect(result.current.status).toBe('ready'));
    const before = result.current.state.spreadIndex;

    result.current.actions.goToPage(0);
    result.current.actions.goToPage(NaN);
    result.current.actions.goToPage(3.5);
    result.current.actions.goToPage(11);

    // No rerender triggered for OOB — spreadIndex unchanged.
    expect(result.current.state.spreadIndex).toBe(before);
    // Exactly one dev-warning (the one-shot warned-ref pattern).
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid input'));

    warnSpy.mockRestore();
  });
});

describe('actions.enterFullScreen — wraps requestFullscreen + resolves on transition', () => {
  it('actions.enterFullScreen wraps requestFullscreen and resolves on transition', async () => {
    const originalRequestFs = HTMLElement.prototype.requestFullscreen;
    const originalExitFs = document.exitFullscreen;
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null, writable: true });

    let resolveFs!: () => void;
    HTMLElement.prototype.requestFullscreen = vi.fn(() => new Promise<void>((res) => { resolveFs = res; }));
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);

    try {
      const source = makeSource();
      const { result } = renderHook(() => useFlipbook(), { wrapper: wrap(source) });
      await vi.waitFor(() => expect(result.current.status).toBe('ready'));

      const rootElement = document.querySelector('.fbjs-root') as HTMLElement;
      expect(rootElement).not.toBeNull();

      let enterPromise!: Promise<void>;
      await act(async () => {
        enterPromise = result.current.actions.enterFullScreen();
      });

      // Drive the listener: resolve the underlying requestFullscreen and
      // dispatch fullscreenchange with our root as the fullscreenElement.
      resolveFs();
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: rootElement, writable: true });
      await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

      await enterPromise;
      await vi.waitFor(() => expect(result.current.state.isFullScreen).toBe(true));

      // Settle the exit so cleanup() doesn't reject pending Promises.
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null, writable: true });
      await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    } finally {
      HTMLElement.prototype.requestFullscreen = originalRequestFs;
      document.exitFullscreen = originalExitFs;
    }
  });
});
