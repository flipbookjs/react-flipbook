import { describe, expect, it, vi } from 'vitest';
import React, { StrictMode } from 'react';
import { act, renderHook, render } from '@testing-library/react';
import { FlipbookProvider } from '../FlipbookProvider';
import { useFlipbookSelector, useFlipbookActions, shallowEqual } from '../hooks/useFlipbook';
import type { FlipbookHookActions } from '../hooks/useFlipbook';
import type { PageSource } from '../types/PageSource';

function makeSource(pageCount = 4): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => pageCount,
    getPageSize: () => ({ width: 612, height: 792 }),
    // renderPage must return a Promise<HTMLCanvasElement> because PageRenderer
    // (mounted by SpreadRenderer once container dims + ready state are set)
    // chains `.then()` on the result. `vi.fn()` alone returns undefined and
    // causes TypeError. Same fix as Step 7.2.
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

const wrap = (source: PageSource) => ({ children }: { children: React.ReactNode }) =>
  <FlipbookProvider source={source}>{children}</FlipbookProvider>;

/**
 * Test harness factory: returns a Provider tree with a MEMOIZED Probe + an
 * always-rendered Dispatcher. The memo is load-bearing — it blocks the parent-
 * driven re-render so the test can isolate selector-skip behavior. Without
 * React.memo, the provider's render (triggered by ANY dispatch) would force
 * Probe to re-render regardless of selector return value, defeating the test.
 *
 * Dispatcher captures the actions object via useFlipbookActions so the test
 * can fire `actions.next()` etc. from the test body. Dispatcher is NOT memoized
 * (it doesn't need to be — we don't count its renders).
 */
function makeHarness<TSelected>(
  selector: (s: import('../hooks/useFlipbook').FlipbookSnapshot) => TSelected,
  isEqual?: (a: TSelected, b: TSelected) => boolean,
) {
  let probeRenderCount = 0;
  let lastSelected: TSelected | undefined;
  let capturedActions: FlipbookHookActions | null = null;

  const Probe = React.memo(function Probe() {
    lastSelected = useFlipbookSelector(selector, isEqual);
    probeRenderCount++;
    return null;
  });

  function Dispatcher() {
    capturedActions = useFlipbookActions();
    return null;
  }

  function Tree({ source }: { source: PageSource }) {
    return (
      <FlipbookProvider source={source}>
        <Dispatcher />
        <Probe />
      </FlipbookProvider>
    );
  }

  return {
    Tree,
    getProbeRenderCount: () => probeRenderCount,
    getLastSelected: () => lastSelected,
    getActions: () => capturedActions,
  };
}

describe('useFlipbookSelector — skip-on-equal behavior', () => {
  it('returns the selected value', async () => {
    const source = makeSource(4);
    const { result } = renderHook(
      () => useFlipbookSelector((s) => s.state.totalPages),
      { wrapper: wrap(source) },
    );
    await vi.waitFor(() => expect(result.current).toBe(4));
  });

  it('skips re-render when selected primitive does not change across a real dispatch', async () => {
    // Probe selects totalPages (does NOT change on NEXT_SPREAD). With Object.is
    // equality + a memo'd Probe, the dispatch should NOT cause Probe to re-render.
    const source = makeSource(4);
    const harness = makeHarness((s) => s.state.totalPages);

    render(<harness.Tree source={source} />);
    await vi.waitFor(() => expect(harness.getActions()).not.toBeNull());
    // Wait for source.init() + SOURCE_CHANGED to settle so we're not racing initial dispatches.
    await vi.waitFor(() => expect(harness.getLastSelected()).toBe(4));
    const baseline = harness.getProbeRenderCount();

    // Three dispatches that do NOT change state.totalPages.
    act(() => { harness.getActions()!.next(); });
    act(() => { harness.getActions()!.next(); });
    act(() => { harness.getActions()!.next(); });

    // Memo blocks the props-driven re-render; the store subscription doesn't
    // schedule one either because the selector's output is === to the previous.
    expect(harness.getProbeRenderCount()).toBe(baseline);
  });

  it('object-literal selector + Object.is default re-renders on EVERY snapshot change', async () => {
    // Pathological case: selector returns a new object on every call. Object.is
    // (the default) compares by identity → always different → store schedules
    // a re-render even through React.memo (memo doesn't block subscription-
    // driven re-renders).
    const source = makeSource(4);
    const harness = makeHarness((s) => ({ totalPages: s.state.totalPages }));

    render(<harness.Tree source={source} />);
    await vi.waitFor(() => expect(harness.getActions()).not.toBeNull());
    await vi.waitFor(() => expect(harness.getLastSelected()).toEqual({ totalPages: 4 }));
    const baseline = harness.getProbeRenderCount();

    act(() => { harness.getActions()!.next(); });
    act(() => { harness.getActions()!.next(); });

    // 2 dispatches → 2 extra renders. Memo does NOT block subscription-driven
    // re-renders; Object.is fails on the new object literal each time.
    expect(harness.getProbeRenderCount() - baseline).toBe(2);
  });

  it('object-literal selector + shallowEqual skips re-render when shallow-equal', async () => {
    // Same selector shape, but with shallowEqual: the literal's values match
    // prev/next → shallowEqual returns true → subscription does NOT schedule
    // a re-render. React.memo blocks the parent-driven path. Net: no re-render.
    const source = makeSource(4);
    const harness = makeHarness(
      (s) => ({ totalPages: s.state.totalPages }),
      shallowEqual,
    );

    render(<harness.Tree source={source} />);
    await vi.waitFor(() => expect(harness.getActions()).not.toBeNull());
    await vi.waitFor(() => expect(harness.getLastSelected()).toEqual({ totalPages: 4 }));
    const baseline = harness.getProbeRenderCount();

    act(() => { harness.getActions()!.next(); });
    act(() => { harness.getActions()!.next(); });

    // totalPages didn't change → shallowEqual returns true → no re-render.
    expect(harness.getProbeRenderCount()).toBe(baseline);
  });

  it('SOURCE_CHANGED causes re-render even with shallowEqual when selected value changes', async () => {
    // Sanity check: when the selected value DOES change (because totalPages
    // changes on source rotation), shallowEqual must NOT skip — the consumer
    // must re-render to see the new totalPages.
    const sourceA = makeSource(4);
    const sourceB = makeSource(6);
    const harness = makeHarness(
      (s) => ({ totalPages: s.state.totalPages }),
      shallowEqual,
    );

    let currentSource: PageSource = sourceA;
    function App() {
      return <harness.Tree source={currentSource} />;
    }
    const { rerender } = render(<App />);
    await vi.waitFor(() => expect(harness.getLastSelected()).toEqual({ totalPages: 4 }));
    const baseline = harness.getProbeRenderCount();

    currentSource = sourceB;
    rerender(<App />);
    await vi.waitFor(() => expect(harness.getLastSelected()).toEqual({ totalPages: 6 }));

    // totalPages changed (4 → 6) → shallowEqual returns false → re-render happened.
    expect(harness.getProbeRenderCount()).toBeGreaterThan(baseline);
  });
});

describe('useFlipbookActions — rotates only on source change', () => {
  it('returns the same actions object across non-source-change renders', async () => {
    const source = makeSource(4);
    const { result, rerender } = renderHook(
      () => useFlipbookActions(),
      { wrapper: wrap(source) },
    );
    const a1 = result.current;
    rerender();
    const a2 = result.current;
    expect(a2).toBe(a1);
  });

  it('rotates on source change', async () => {
    const sourceA = makeSource(4);
    const sourceB = makeSource(6);

    // Closure-variable pattern — see useFlipbook.test.tsx for the rationale.
    let currentSource: PageSource = sourceA;
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <FlipbookProvider source={currentSource}>{children}</FlipbookProvider>;

    const { result, rerender } = renderHook(() => useFlipbookActions(), { wrapper });
    const a1 = result.current;

    currentSource = sourceB;
    rerender();
    // Wait for the provider to settle on the new source — source identity in
    // useMemo deps rotates synchronously, so the new actions object is available
    // immediately after rerender.
    const a2 = result.current;
    expect(a2).not.toBe(a1);   // identity rotated
  });
});

describe('StrictMode regression', () => {
  it('does not warn or break when wrapped in StrictMode', async () => {
    const source = makeSource(4);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <StrictMode>
        <FlipbookProvider source={source}>
          <div>child</div>
        </FlipbookProvider>
      </StrictMode>,
    );
    await vi.waitFor(() => expect(true).toBe(true));   // let any deferred warnings flush
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    warn.mockRestore();
    err.mockRestore();
  });
});
