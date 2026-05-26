// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useImperativeHandle, forwardRef, type ReactNode, type Ref } from 'react';
import { FlipbookContext, type FlipbookContextValue } from '../core/FlipbookContext';
import type { FlipbookState } from '../core/flipbookReducer';
import { useCurlAnimation } from '../curl/useCurlAnimation';
import type { PageSource } from '../types/PageSource';
import type { Spread } from '../core/computeSpreads';

// Stub PageSource — useCurlAnimation only reads .getPageCount() etc. via context state.
const stubSource = {
  init: () => Promise.resolve(),
  getPageCount: () => 10,
  getPageSize: () => ({ width: 600, height: 800 }),
  renderPage: () => Promise.resolve(document.createElement('canvas')),
  dispose: () => {},
} satisfies PageSource;

// 10 pages in dual-cover mode → 6 spreads: cover, 4 dual spreads, back cover.
// Spread shape: { left: number | null; right: number | null } per computeSpreads.ts.
const stubSpreads: Spread[] = [
  { left: null, right: 0 },   // cover (right-only)
  { left: 1, right: 2 },      // dual spread
  { left: 3, right: 4 },      // dual spread
  { left: 5, right: 6 },      // dual spread
  { left: 7, right: 8 },      // dual spread
  { left: 9, right: null },   // back cover (left-only)
];

const baseState: FlipbookState = {
  currentSpreadIndex: 2,
  pageCount: 10,
  spreadCount: 6,
  viewMode: 'dual-cover',
  resolvedViewMode: 'dual-cover',
  containerWidth: 1024,
  containerHeight: 768,
};

function makeCtxValue(stateOverride: Partial<FlipbookState> = {}, dispatch = vi.fn()): FlipbookContextValue {
  return {
    state: { ...baseState, ...stateOverride },
    dispatch,
    source: stubSource,
    spreads: stubSpreads,
    effectiveScale: 1,
  };
}

// Stateful wrapper: exposes setCtx to mutate context mid-test.
interface CtxControl {
  setCtx: (next: FlipbookContextValue) => void;
}

const StatefulWrapper = forwardRef(function StatefulWrapper(
  { initial, children }: { initial: FlipbookContextValue; children: ReactNode },
  ref: Ref<CtxControl>
) {
  const [ctx, setCtx] = useState(initial);
  useImperativeHandle(ref, () => ({ setCtx }), []);
  return <FlipbookContext.Provider value={ctx}>{children}</FlipbookContext.Provider>;
});

function renderWithCtx(initial: FlipbookContextValue, params: Parameters<typeof useCurlAnimation>[0]) {
  const controlRef: { current: CtxControl | null } = { current: null };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StatefulWrapper initial={initial} ref={(r) => { controlRef.current = r; }}>{children}</StatefulWrapper>
  );
  const hook = renderHook(() => useCurlAnimation(params), { wrapper });
  return { ...hook, controlRef };
}

let cancelSignal = 0;
const getCancelSignal = () => cancelSignal;
const params = {
  enabled: true,
  getCancelSignal,
  pageWidth: 600,
  pageHeight: 800,
};

beforeEach(() => { cancelSignal = 0; });

describe('useCurlAnimation — state machine transitions', () => {
  it('starts in idle state', () => {
    const { result } = renderWithCtx(makeCtxValue(), params);
    expect(result.current.snapshot.state).toBe('idle');
  });

  it('idle → hovering on startHover; hovering → idle on endHover (after 200ms hover-out anim)', () => {
    // endHover transitions through 'animating' state during a ~200ms hover-out
    // animation, then publishes 'idle' from the rAF callback when t===1.
    // Need fake timers to advance past the animation.
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const { result } = renderWithCtx(makeCtxValue(), params);

    act(() => { result.current.actions.startHover('next'); });
    expect(result.current.snapshot.state).toBe('hovering');

    act(() => { result.current.actions.endHover(); });
    // Drive past the 200ms hover-out animation so the rAF callback transitions to idle.
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current.snapshot.state).toBe('idle');
    vi.useRealTimers();
  });

  it('idle → dragging on startDrag; captures snapshot of current state', () => {
    const { result } = renderWithCtx(makeCtxValue(), params);

    act(() => {
      result.current.actions.startDrag('next');
    });
    expect(result.current.snapshot.state).toBe('dragging');
    expect(result.current.snapshot.direction).toBe('next');
    // Snapshot capture is verified indirectly by the anti-race test below.
  });

  it('cancel from any state returns to idle', () => {
    const { result } = renderWithCtx(makeCtxValue(), params);

    act(() => { result.current.actions.startDrag('next'); });
    expect(result.current.snapshot.state).toBe('dragging');

    act(() => { result.current.actions.cancel(); });
    expect(result.current.snapshot.state).toBe('idle');
  });

  it('anti-race: commit cancels if state drifted (currentSpreadIndex changed mid-drag)', () => {
    // Commit runs from the rAF callback at animation END (~900ms per Decision 13),
    // not synchronously from endDrag. Fake timers required to flush the animation.
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

    const dispatch = vi.fn();
    const initial = makeCtxValue({}, dispatch);
    const { result, controlRef } = renderWithCtx(initial, params);

    // Start drag at spread 2 → snapshot captures currentSpreadIndex=2, targetSpreadIndex=3.
    act(() => { result.current.actions.startDrag('next'); });

    // Simulate state drift via stateful wrapper: context value mutates → re-render →
    // render-time assignment syncs currentContextRef.current to the new state
    // (NOT a useEffect — render-time, see 4.B).
    act(() => {
      controlRef.current!.setCtx(makeCtxValue({ currentSpreadIndex: 0 }, dispatch));
    });

    // End drag past threshold → state goes to 'animating' → rAF loop starts.
    // Use a mid-page interior point so calcCurl returns non-null with progress
    // above commitThreshold (0.3). y=800 (page edge) can trigger degenerate paths.
    act(() => { result.current.actions.updateDrag({ x: 100, y: 400 }); });
    act(() => { result.current.actions.endDrag(); });

    // Advance through full 900ms animation duration — commit fires at end.
    act(() => { vi.advanceTimersByTime(1000); });

    // Drift detected → cancel() ran instead of dispatch.
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GO_TO_SPREAD' }));

    vi.useRealTimers();
  });

  it('cancelSignal increment cancels in-flight animation (rAF frame detects bump)', () => {
    // Exercises the actual cancelSignal pathway: rAF frame callback reads
    // getCancelSignal() each frame and cancels when it differs from the captured
    // value. A test that just calls cancel() directly would pass even if the
    // frame callback never checked the signal.
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

    const dispatch = vi.fn();
    const { result } = renderWithCtx(makeCtxValue({}, dispatch), params);

    act(() => { result.current.actions.setRenderCallback(vi.fn()); }); // mirror production: CurlOverlay registers before any curl starts
    act(() => { result.current.actions.startAnimatedCurl('next'); });
    expect(result.current.snapshot.state).toBe('animating');

    // Tick a couple of frames so the animation is mid-flight.
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.snapshot.state).toBe('animating');

    // External cancellation via cancelSignal bump.
    cancelSignal++;

    // Next rAF frame must see the bump and cancel — drive timers past it.
    act(() => { vi.advanceTimersByTime(50); });

    expect(result.current.snapshot.state).toBe('idle');
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GO_TO_SPREAD' }));

    vi.useRealTimers();
  });

  it('curlActions object is referentially stable across re-renders (HG2)', () => {
    const { result, rerender } = renderWithCtx(makeCtxValue(), params);
    const actions1 = result.current.actions;

    rerender();
    const actions2 = result.current.actions;

    expect(actions2).toBe(actions1);
  });

  it('cleanup cancels in-flight rAF on unmount (P4)', () => {
    const cancelRAFSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const { result, unmount } = renderWithCtx(makeCtxValue(), params);

    act(() => { result.current.actions.setRenderCallback(vi.fn()); }); // mirror production: CurlOverlay registers before any curl starts
    act(() => { result.current.actions.startAnimatedCurl('next'); });
    unmount();

    expect(cancelRAFSpy).toHaveBeenCalled();
    cancelRAFSpy.mockRestore();
  });

  it('anti-race positive control: no drift → commit dispatches GO_TO_SPREAD to target', () => {
    // Paired with the anti-race test above. Same setup, no setCtx drift.
    // If this test fails, the anti-race test could be passing for the wrong reason
    // (commit broken, animation never reaching threshold, etc.).
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

    const dispatch = vi.fn();
    const { result } = renderWithCtx(makeCtxValue({}, dispatch), params);

    act(() => { result.current.actions.startDrag('next'); });
    // Mid-page interior point — calcCurl produces non-null result with progress
    // above commitThreshold (0.3). y at page edge (e.g., y=800) can degenerate.
    act(() => { result.current.actions.updateDrag({ x: 100, y: 400 }); });
    act(() => { result.current.actions.endDrag(); });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(dispatch).toHaveBeenCalledWith({ type: 'GO_TO_SPREAD', index: 3 });

    vi.useRealTimers();
  });

  it('startAnimatedCurl path commits (wheel/programmatic curls reach dispatch)', () => {
    // Wheel scrolling and programmatic API enter via startAnimatedCurl, not startDrag.
    // captureSnapshot MUST populate dragStartSnapshotRef from both entry points;
    // otherwise commit() sees snap === null and silently skips dispatch.
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

    const dispatch = vi.fn();
    const { result } = renderWithCtx(makeCtxValue({}, dispatch), params);

    act(() => { result.current.actions.setRenderCallback(vi.fn()); }); // mirror production: CurlOverlay registers before any curl starts
    act(() => { result.current.actions.startAnimatedCurl('next'); });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(dispatch).toHaveBeenCalledWith({ type: 'GO_TO_SPREAD', index: 3 });

    vi.useRealTimers();
  });

  it('enabled: false → actions are no-ops, snapshot stays idle', () => {
    const dispatch = vi.fn();
    const disabledParams = { ...params, enabled: false };
    const { result } = renderWithCtx(makeCtxValue({}, dispatch), disabledParams);

    expect(result.current.snapshot.state).toBe('idle');

    act(() => { result.current.actions.startDrag('next'); });
    act(() => { result.current.actions.setRenderCallback(vi.fn()); }); // mirror production: CurlOverlay registers before any curl starts
    act(() => { result.current.actions.startAnimatedCurl('next'); });
    act(() => { result.current.actions.startHover('next'); });

    expect(result.current.snapshot.state).toBe('idle');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('toggling enabled true→false mid-drag cancels (via useEffect transition)', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

    // Exercises the cancel-on-disable side effect in the useEffect:
    // dragging → enabled flips false → useEffect calls cancel() → idle.
    const ctx = makeCtxValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FlipbookContext.Provider value={ctx}>{children}</FlipbookContext.Provider>
    );

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCurlAnimation({
        enabled,
        getCancelSignal,
        pageWidth: 600,
        pageHeight: 800,
      }),
      { initialProps: { enabled: true }, wrapper },
    );

    act(() => { result.current.actions.startDrag('next'); });
    expect(result.current.snapshot.state).toBe('dragging');

    act(() => { rerender({ enabled: false }); });

    expect(result.current.snapshot.state).toBe('idle');
    vi.useRealTimers();
  });

  it('disabling mid-animation prevents GO_TO_SPREAD dispatch (via cancel-on-disable)', () => {
    // This test asserts the broader contract: animation in flight + enabled flips
    // false ⇒ no commit. In practice the cancel-on-disable useEffect handles this,
    // because @testing-library/react's `act(() => rerender(...))` flushes passive
    // effects synchronously — so `cancel()` runs before any later
    // `advanceTimersByTime` lets the rAF loop tick again.
    //
    // **The in-loop animateLoop guard (`if (!enabledRef.current) { clearState(); return; }`
    // at the top of animateLoop in 4.B) is intentionally code-review-verified, not
    // unit-tested.** Isolating its specific race window — render-time enabledRef
    // flipped false, BUT the useEffect's cancel() not yet run, AND a queued rAF
    // fires in between — requires either reaching into hook internals or stubbing
    // cancel mid-test. Both are too fragile to be worth the coverage. The guard
    // exists for the live-runtime race where act() does not serialize this order,
    // and is verified by inspection of 4.B animateLoop's top guard.
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

    const dispatch = vi.fn();
    const ctx = makeCtxValue({}, dispatch);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <FlipbookContext.Provider value={ctx}>{children}</FlipbookContext.Provider>
    );

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCurlAnimation({
        enabled,
        getCancelSignal,
        pageWidth: 600,
        pageHeight: 800,
      }),
      { initialProps: { enabled: true }, wrapper },
    );

    // startAnimatedCurl puts state directly into 'animating' (via startAutoAnimate).
    act(() => { result.current.actions.setRenderCallback(vi.fn()); }); // mirror production: CurlOverlay registers before any curl starts
    act(() => { result.current.actions.startAnimatedCurl('next'); });
    expect(result.current.snapshot.state).toBe('animating');

    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current.snapshot.state).toBe('animating');

    // Disable mid-animation. Under act(), both the render-time sync and the
    // passive useEffect's cancel() fire before this returns.
    act(() => { rerender({ enabled: false }); });

    // Drive timers past full animation duration. No commit must have happened
    // regardless of which guard path actually fired (useEffect cancel OR in-loop guard).
    act(() => { vi.advanceTimersByTime(1500); });

    expect(result.current.snapshot.state).toBe('idle');
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GO_TO_SPREAD' }));
    vi.useRealTimers();
  });
});
