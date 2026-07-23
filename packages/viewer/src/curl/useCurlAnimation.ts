// No 'use client' directive — Step 2's convention is to mark only the top-level
// boundary (Flipbook.tsx). The directive propagates through imports; adding it
// here would be redundant.

import { useEffect, useMemo, useRef, useState } from 'react';
import { type Point, type PageRect, calcCurl, type CurlResult } from './CurlCalculation';
import { curlAssert } from './types';
import { useFlipbookContext } from '../core/FlipbookContext';
import type { FlipbookState } from '../core/flipbookReducer';
import type { PageSource } from '../types/PageSource';

export type CurlState = 'idle' | 'hovering' | 'dragging' | 'animating';

interface CurlAnimationConfig {
  animationDuration: number;
  commitThreshold: number;
}

const DEFAULT_CONFIG: CurlAnimationConfig = {
  animationDuration: 900,
  commitThreshold: 0.3,
};

/** How far the corner peels on hover (fraction of page width from outer edge). */
const HOVER_PEEK_FRACTION = 0.05;

/** Snapshot captured at drag/animation start for anti-race commit detection. */
interface DragStartSnapshot {
  currentSpreadIndex: number;
  resolvedViewMode: 'single' | 'dual-cover';
  pageCount: number;
  source: PageSource;
  targetSpreadIndex: number;
}

interface CurrentContext {
  state: FlipbookState;
  source: PageSource;
}

/** Parameters useCurlMode passes to useCurlAnimation. */
export interface UseCurlAnimationParams {
  /**
   * Whether the hook is active.
   * - `false`: action methods (except `cancel` and `setRenderCallback`) early-return;
   *   no listeners attached; if a curl is in flight when `enabled` flips false,
   *   `cancel()` runs automatically. `snapshot.state` stays 'idle'.
   * - Toggling true→false→true restarts cleanly (actions reference is stable).
   */
  enabled: boolean;
  /** Returns the latest cancel-signal counter owned by useCurlMode (Decision 18). */
  getCancelSignal: () => number;
  /** Single-page width in CSS pixels at current scale — for calcCurl geometry. */
  pageWidth: number;
  /** Single-page height in CSS pixels at current scale. */
  pageHeight: number;
}

/** Snapshot of animation state — React state. Re-publishes only on state transitions. */
export interface CurlAnimationSnapshot {
  state: CurlState;
  direction: 'next' | 'previous';
  /** True when idle was reached via a committed curl (spread changed). Reset on next gesture start. */
  committed: boolean;
}

/** Stable actions object — referentially stable across renders. */
export interface CurlAnimationActions {
  startDrag: (direction: 'next' | 'previous') => void;
  updateDrag: (point: Point) => void;
  endDrag: () => void;
  /** Returns true if the animation actually started, false if a guard rejected it
   *  (not enabled, or not in an idle/hovering state). Callers that need to fall
   *  back to a plain snap (programmatic nav) read this; the wheel caller ignores it. */
  startAnimatedCurl: (direction: 'next' | 'previous') => boolean;
  /** Show a small corner peel hint. */
  startHover: (direction: 'next' | 'previous') => void;
  /** Hide the corner peel hint. */
  endHover: () => void;
  /** Cancel any in-progress drag/animation and return to idle. */
  cancel: () => void;
  /** True while dragging OR animating (busy-state contract). */
  isAnimating: () => boolean;
  /** Register the per-frame render callback. Called by CurlOverlay on mount. */
  setRenderCallback: (fn: ((curl: CurlResult, direction: 'next' | 'previous') => void) | null) => void;
}

/** Return shape. */
export interface UseCurlAnimationReturn {
  actions: CurlAnimationActions;
  snapshot: CurlAnimationSnapshot;
}

export const useCurlAnimation = (
  params: UseCurlAnimationParams,
): UseCurlAnimationReturn => {
  const cfg = DEFAULT_CONFIG;
  const { state, dispatch, source } = useFlipbookContext();

  // PageRect synced from params each render (replaces old fork's pageRect parameter).
  const pageRectRef = useRef<PageRect>({ width: params.pageWidth, height: params.pageHeight });
  pageRectRef.current = { width: params.pageWidth, height: params.pageHeight };

  // State machine refs — old fork pattern, preserved.
  const stateRef = useRef<CurlState>('idle');
  const directionRef = useRef<'next' | 'previous'>('next');
  const curlResultRef = useRef<CurlResult | null>(null);
  const dragPointRef = useRef<Point>({ x: 0, y: 0 });
  const committedRef = useRef(false);

  // Animation refs — old fork pattern, preserved.
  const rafRef = useRef<number>(0);
  const animStartTimeRef = useRef<number>(0);
  const animStartPointRef = useRef<Point>({ x: 0, y: 0 });
  const animTargetPointRef = useRef<Point>({ x: 0, y: 0 });
  const animDurationRef = useRef<number>(cfg.animationDuration);

  // Per-frame render callback — set by CurlOverlay, called from rAF loop.
  const renderCallbackRef = useRef<
    ((curl: CurlResult, direction: 'next' | 'previous') => void) | null
  >(null);

  // NEW — replaces old fork's commitFnRef. Truthy/falsy signal read by animateLoop
  // to decide between completeAnimation() and clearState() at animation end.
  const shouldCommitRef = useRef<boolean>(false);

  // NEW — snapshot captured at gesture start for anti-race commit (Decision 15).
  const dragStartSnapshotRef = useRef<DragStartSnapshot | null>(null);

  // NEW — current context (state + source) for stale-closure-free commit + drift check.
  // Synced render-time below (NOT in a useEffect — would run after paint and miss
  // the anti-race case). Reads inside rAF callbacks see the latest value.
  const currentContextRef = useRef<CurrentContext>({ state, source });

  // NEW — captured cancelSignal counter (Decision 18) at animation start.
  // INVARIANT: initial value 0 is irrelevant. startAutoAnimate always assigns
  // this ref BEFORE scheduling animateLoop, and animateLoop is the only reader.
  // If a future refactor schedules animateLoop without going through
  // startAutoAnimate, this initial value would matter — update accordingly.
  const cancelSignalAtStartRef = useRef<number>(0);
  // NEW — latest cancelSignal reader. Actions are memoized with [], so animation
  // code reads the latest callback through this ref instead of closing over params.
  const getCancelSignalRef = useRef(params.getCancelSignal);

  // NEW — enabled gate for action methods + animateLoop guard. Synced render-time
  // below (NOT via useEffect — passive effects miss queued rAF ticks).
  const enabledRef = useRef<boolean>(params.enabled);

  // NEW — previous enabled value, used by the useEffect to detect the true→false
  // transition for the cancel-on-disable side effect. Separate from enabledRef
  // so the guard always reads the latest value.
  const prevEnabledRef = useRef<boolean>(params.enabled);

  // React state — re-renders consumers only on transitions, never per-frame.
  const [snapshot, setSnapshot] = useState<CurlAnimationSnapshot>({
    state: 'idle',
    direction: 'next',
    committed: false,
  });

  // Sync currentContextRef render-time, NOT in useEffect. A passive useEffect runs
  // after paint, so a competing dispatch + commit() pair could complete BEFORE the
  // effect sees the new state — exactly the anti-race case this ref exists to detect.
  // Render-time assignment matches the pageRectRef pattern (and old fork's
  // pageRectRef.current = pageRect at useCurlAnimation.ts:63).
  currentContextRef.current = { state, source };

  // Sync enabledRef render-time (same race-avoidance reason as currentContextRef).
  // A passive useEffect runs after paint, so a queued rAF could fire animateLoop
  // and commit BEFORE the effect sees the new value of params.enabled. Render-time
  // assignment + the in-loop guard below prevents that. The useEffect still runs
  // for the cancel-on-disable side effect via prevEnabledRef.
  enabledRef.current = params.enabled;

  useEffect(() => {
    const wasEnabled = prevEnabledRef.current;
    prevEnabledRef.current = params.enabled;
    if (wasEnabled && !params.enabled) {
      // Cancel any in-flight curl on the true→false transition.
      cancel();
    }
  }, [params.enabled]);

  // Sync params.getCancelSignal into a ref so action methods can read it without
  // closing over params. Actions are memoized with []; closing over `params`
  // directly would freeze the callback at the first render's value.
  getCancelSignalRef.current = params.getCancelSignal;

  // Preserved verbatim from old fork useCurlAnimation.ts:97-105.
  const recalcAndRender = (point: Point) => {
    const result = calcCurl(point, pageRectRef.current, directionRef.current);
    curlResultRef.current = result;
    // Direct canvas paint — no React re-render
    if (result) {
      renderCallbackRef.current?.(result, directionRef.current);
    }
  };

  // Preserved verbatim from old fork useCurlAnimation.ts:181-187.
  const getCompletePoint = (): Point => {
    const pr = pageRectRef.current;
    // StPageFlip animates y toward pageHeight at the end — the fold
    // flattens as angle approaches 0, keeping the position within the
    // constraint circle. Using pageHeight here matches that behavior.
    return { x: -pr.width, y: pr.height };
  };

  // Preserved verbatim from old fork useCurlAnimation.ts:189-196.
  const getCancelPoint = (): Point => {
    const pr = pageRectRef.current;
    // y offset from corner creates visible fold angle at animation start.
    // StPageFlip uses height - height/10 = 0.9 * height.
    // getCompletePoint uses y=height so the fold flattens at the end.
    return { x: pr.width, y: pr.height * 0.9 };
  };

  // Old fork pattern — published only on state transitions, never per-frame.
  const publishStateChange = () => {
    setSnapshot({
      state: stateRef.current,
      direction: directionRef.current,
      committed: committedRef.current,
    });
  };

  // Called from startDrag AND startAnimatedCurl so every code path that ends in
  // commit() has a populated snapshot. Without this in startAnimatedCurl, wheel
  // and programmatic curls would animate to completion but commit() would see
  // snap === null and silently skip dispatch.
  const captureSnapshot = (direction: 'next' | 'previous'): void => {
    const ctx = currentContextRef.current;
    const targetSpreadIndex = direction === 'next'
      ? ctx.state.currentSpreadIndex + 1
      : ctx.state.currentSpreadIndex - 1;

    dragStartSnapshotRef.current = {
      currentSpreadIndex: ctx.state.currentSpreadIndex,
      resolvedViewMode: ctx.state.resolvedViewMode,
      pageCount: ctx.state.pageCount,
      source: ctx.source,
      targetSpreadIndex,
    };
  };

  // Returns true if dispatch happened; false if cancelled due to drift.
  // All reads via currentContextRef — never close over `state`/`source` from
  // the hook-body scope (stale across rAF frames).
  const commit = (): boolean => {
    const snap = dragStartSnapshotRef.current;
    if (!snap) return false;

    const ctx = currentContextRef.current;
    if (
      ctx.state.currentSpreadIndex !== snap.currentSpreadIndex ||
      ctx.state.resolvedViewMode !== snap.resolvedViewMode ||
      ctx.state.pageCount !== snap.pageCount ||
      ctx.source !== snap.source
    ) {
      // Drift — competing input won. Don't dispatch.
      dragStartSnapshotRef.current = null;
      return false;
    }

    // dispatch is referentially stable per useReducer contract — safe to close over.
    dispatch({ type: 'GO_TO_SPREAD', index: snap.targetSpreadIndex });
    dragStartSnapshotRef.current = null;
    return true;
  };

  const clearState = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    stateRef.current = 'idle';
    curlResultRef.current = null;
    shouldCommitRef.current = false;           // CHANGED: was commitFnRef.current = null
    dragStartSnapshotRef.current = null;       // NEW: clear stale snapshot
    publishStateChange();                       // publishes idle WITH current committed value
    committedRef.current = false;               // reset AFTER publish (old fork order)
  };

  const completeAnimation = () => {
    const didCommit = commit();                 // CHANGED: was Promise.resolve().then(fn)...
    if (didCommit) committedRef.current = true;
    clearState();
  };

  const animateLoop = (timestamp: number) => {
    if (stateRef.current !== 'animating') return;

    // Disabled mid-flight: race window is "after render-time enabledRef flipped
    // false, but before the passive useEffect's cancel() runs". A rAF tick in
    // that window would otherwise complete/commit despite the host having
    // disabled the hook. This guard catches it.
    if (!enabledRef.current) {
      clearState();
      return;
    }

    // NEW (Decision 18): external cancellation via useCurlMode's cancelSignal.
    // Read via getCancelSignalRef — actions are memoized with []; closing over
    // params.getCancelSignal directly would freeze on the first render's callback.
    if (getCancelSignalRef.current() !== cancelSignalAtStartRef.current) {
      clearState();
      return;
    }

    // Preserved verbatim from old fork useCurlAnimation.ts:134-142.
    const elapsed = timestamp - animStartTimeRef.current;
    const t = Math.min(elapsed / animDurationRef.current, 1);
    const eased = 1 - Math.pow(1 - t, 4);
    const currentPoint: Point = {
      x: animStartPointRef.current.x + (animTargetPointRef.current.x - animStartPointRef.current.x) * eased,
      y: animStartPointRef.current.y + (animTargetPointRef.current.y - animStartPointRef.current.y) * eased,
    };
    recalcAndRender(currentPoint);

    if (t < 1) {
      rafRef.current = requestAnimationFrame(animateLoop);
    } else {
      if (shouldCommitRef.current) {            // CHANGED: was commitFnRef.current
        completeAnimation();
      } else {
        clearState();
      }
    }
  };

  const startAutoAnimate = (fromPoint: Point, toPoint: Point, commit: boolean) => {
    // NEW (Decision 18): capture cancel signal at animation start.
    // Read via getCancelSignalRef (not params directly) for the same reason as animateLoop.
    cancelSignalAtStartRef.current = getCancelSignalRef.current();
    // NEW: set the commit/cancel signal for animateLoop's final branch.
    shouldCommitRef.current = commit;

    // Preserved verbatim from old fork useCurlAnimation.ts:158-172.
    stateRef.current = 'animating';
    animStartTimeRef.current = performance.now();
    animStartPointRef.current = fromPoint;
    animTargetPointRef.current = toPoint;

    // Scale duration by remaining distance — old fork comment preserved.
    const pr = pageRectRef.current;
    const fullDistance = pr.width * 2;
    const remainingDistance = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
    const fraction = Math.max(0.5, Math.min(1, remainingDistance / fullDistance));
    animDurationRef.current = cfg.animationDuration * fraction;

    publishStateChange();
    rafRef.current = requestAnimationFrame(animateLoop);
  };

  const startHover = (direction: 'next' | 'previous') => {
    if (!enabledRef.current) return;
    if (stateRef.current !== 'idle') return;
    stateRef.current = 'hovering';
    directionRef.current = direction;
    // Hover-in animation preserved verbatim from old fork useCurlAnimation.ts:206-228.
    const pr = pageRectRef.current;
    const startX = pr.width;
    const startY = pr.height;
    const endX = pr.width * (1 - HOVER_PEEK_FRACTION);
    const endY = pr.height * (1 - HOVER_PEEK_FRACTION);
    const startTime = performance.now();
    const duration = 250;
    const animateHoverIn = (now: number) => {
      if (stateRef.current !== 'hovering') return;
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const x = startX + (endX - startX) * eased;
      const y = startY + (endY - startY) * eased;
      recalcAndRender({ x, y });
      if (t < 1) rafRef.current = requestAnimationFrame(animateHoverIn);
    };
    rafRef.current = requestAnimationFrame(animateHoverIn);
    publishStateChange();
  };

  const endHover = () => {
    if (!enabledRef.current) return;
    if (stateRef.current !== 'hovering') return;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    // Hover-out animation preserved verbatim from old fork useCurlAnimation.ts:236-265.
    const pr = pageRectRef.current;
    const currentResult = curlResultRef.current;
    const currentX = currentResult?.flippingPosition.x ?? pr.width;
    const currentY = currentResult?.flippingPosition.y ?? pr.height;
    const targetX = pr.width;
    const targetY = pr.height;
    const startTime = performance.now();
    const duration = 200;
    stateRef.current = 'animating';
    const animateHoverOut = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = t * t;
      const x = currentX + (targetX - currentX) * eased;
      const y = currentY + (targetY - currentY) * eased;
      recalcAndRender({ x, y });
      if (t < 1) {
        rafRef.current = requestAnimationFrame(animateHoverOut);
      } else {
        stateRef.current = 'idle';
        curlResultRef.current = null;
        publishStateChange();
      }
    };
    rafRef.current = requestAnimationFrame(animateHoverOut);
  };

  const startDrag = (direction: 'next' | 'previous') => {
    if (!enabledRef.current) return;
    if (stateRef.current !== 'idle' && stateRef.current !== 'hovering') return;
    curlAssert(
      pageRectRef.current.width > 0 && pageRectRef.current.height > 0,
      'startDrag',
      'pageRect has zero dimensions — overlay may not be sized yet',
      { width: pageRectRef.current.width, height: pageRectRef.current.height },
    );
    stateRef.current = 'dragging';
    directionRef.current = direction;
    captureSnapshot(direction);                 // CHANGED: replaces commitFnRef.current = commitFn
    publishStateChange();
  };

  const updateDrag = (point: Point) => {
    if (!enabledRef.current) return;
    if (stateRef.current !== 'dragging') return;
    dragPointRef.current = point;
    recalcAndRender(point);
    // No React re-render — canvas painted directly via renderCallbackRef.
  };

  const endDrag = () => {
    if (!enabledRef.current) return;
    if (stateRef.current !== 'dragging') return;
    const progress = curlResultRef.current?.progress ?? 0;
    if (progress >= cfg.commitThreshold) {
      startAutoAnimate(dragPointRef.current, getCompletePoint(), true);
    } else {
      startAutoAnimate(dragPointRef.current, getCancelPoint(), false);
    }
  };

  const startAnimatedCurl = (direction: 'next' | 'previous'): boolean => {
    if (!enabledRef.current) return false;
    if (stateRef.current !== 'idle' && stateRef.current !== 'hovering') return false;
    curlAssert(
      pageRectRef.current.width > 0 && pageRectRef.current.height > 0,
      'startAnimatedCurl',
      'pageRect has zero dimensions — overlay may not be sized yet',
      { width: pageRectRef.current.width, height: pageRectRef.current.height },
    );
    curlAssert(
      renderCallbackRef.current !== null,
      'startAnimatedCurl',
      'no render callback registered — CurlOverlay may not be mounted',
    );
    directionRef.current = direction;
    captureSnapshot(direction);                 // CHANGED: replaces commitFnRef.current = commitFn
    const startPoint = getCancelPoint();
    recalcAndRender(startPoint);
    startAutoAnimate(startPoint, getCompletePoint(), true);
    return true;
  };

  const cancel = () => {
    // NOT guarded by enabledRef — must be callable from the disable transition.
    if (stateRef.current === 'idle') return;
    dragStartSnapshotRef.current = null;        // CHANGED: was commitFnRef.current = null
    clearState();
  };

  const setRenderCallback = (
    fn: ((curl: CurlResult, direction: 'next' | 'previous') => void) | null,
  ) => {
    // NOT guarded — CurlOverlay must always be able to register/unregister, even
    // when curl mode is disabled. Otherwise enabling later would have no callback.
    renderCallbackRef.current = fn;
  };

  // Stable reference — methods close over refs only, so empty deps are safe.
  const actions = useMemo<CurlAnimationActions>(() => ({
    startDrag,
    updateDrag,
    endDrag,
    startAnimatedCurl,
    startHover,
    endHover,
    cancel,
    isAnimating: () => stateRef.current === 'dragging' || stateRef.current === 'animating',
    setRenderCallback,
  }), []);

  // rAF cleanup on unmount. Intentionally does NOT call clearState() — that would
  // call setSnapshot() on an unmounting component (React warning). stateRef may
  // remain at 'animating' or 'dragging' post-unmount; that's safe because the refs
  // detach with the component and no consumer can observe them. Consumers must
  // not call action methods after the host component unmounts (standard React
  // hook contract; useCurlMode in 3B handles lifecycle correctly).
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { actions, snapshot };
};
