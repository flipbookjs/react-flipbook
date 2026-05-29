// No 'use client' directive — propagates from CurlOverlay.tsx (the boundary) per Decision 19.

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFlipbook } from '../core/FlipbookContext';
import { useCurlAnimation, type CurlAnimationSnapshot, type CurlAnimationActions } from './useCurlAnimation';
import { usePageCurlGesture } from './usePageCurlGesture';
import { decideCurlWheelDispatch } from './wheelDecision';
import type { PageRegistryRead } from '../core/PageRegistry';
import type { SpreadGeometry } from './spreadGeometry';
import { WHEEL_THROTTLE_MS } from '../zoom/wheelTiming';

export interface UseCurlModeParams {
  /** True when curl should be active. Caller has already AND-gated on showContent +
   *  enablePageCurl + resolvedViewMode === 'dual-cover' + !degraded. */
  enabled: boolean;
  /** Stage container — gesture listeners attach here. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** Overlay canvas ref — pointer-capture target. */
  overlayRef: RefObject<HTMLCanvasElement | null>;
  /** Fresh viewport-space overlay rect from useCurlOverlayRect (or null). */
  overlayRect: DOMRect | null;
  /** Consolidated spread geometry from deriveSpreadGeometry. */
  spreadGeometry: SpreadGeometry;
  /** PageRegistry read-side — bitmap-readiness gates. */
  registryRead: PageRegistryRead;
  /** Registry version (memoization signal for bitmap readiness). */
  registryVersion: number;
}

export interface UseCurlModeReturn {
  /** Re-publishes only on state-machine transitions; never per-frame. */
  snapshot: CurlAnimationSnapshot;
  /** Stable actions ref (memoized with [] inside useCurlAnimation). */
  actions: CurlAnimationActions;
  /** Getter for the current cancelSignal value (consumed by tests; production reads via useCurlAnimation). */
  getCancelSignal: () => number;
}

export const useCurlMode = (params: UseCurlModeParams): UseCurlModeReturn => {
  const { enabled, stageRef, overlayRef, overlayRect, spreadGeometry, registryRead, registryVersion } = params;
  const { state, source, effectiveScale, registerCurlWheelHandler } = useFlipbook();
  const { resolvedViewMode, pageCount } = state;

  // --- Page dimensions (CSS pixels at current scale) ---
  const pageWidth = useMemo(() => {
    if (pageCount === 0) return 0;
    return source.getPageSize(0).width * effectiveScale;
  }, [pageCount, source, effectiveScale]);

  const pageHeight = useMemo(() => {
    if (pageCount === 0) return 0;
    return source.getPageSize(0).height * effectiveScale;
  }, [pageCount, source, effectiveScale]);

  // --- cancelSignal counter (Decision 18) ---
  const cancelSignalRef = useRef(0);
  const getCancelSignal = useMemo(
    () => () => cancelSignalRef.current,
    [],
  );

  // --- useCurlAnimation ---
  const { snapshot, actions } = useCurlAnimation({
    enabled,
    getCancelSignal,
    pageWidth,
    pageHeight,
  });

  // --- Bitmap readiness (Decision 11 preconditions #3/#4) ---
  // Flipping page = first/last of adjacent spread depending on direction.
  // Bottom page = the OTHER end of the same adjacent spread. For single-page adjacent
  // spreads, both ends are the same entry (the check is still valid).
  const nextBitmapReady = useMemo(() => {
    const pages = spreadGeometry.nextPages;
    if (pages.length === 0) return false;
    const first = registryRead.get(pages[0]);
    const last = registryRead.get(pages[pages.length - 1]);
    return !!(first?.canvas && first?.element && last?.canvas && last?.element);
  }, [spreadGeometry.nextPages, registryRead, registryVersion]);

  const prevBitmapReady = useMemo(() => {
    const pages = spreadGeometry.previousPages;
    if (pages.length === 0) return false;
    const first = registryRead.get(pages[0]);
    const last = registryRead.get(pages[pages.length - 1]);
    return !!(first?.canvas && first?.element && last?.canvas && last?.element);
  }, [spreadGeometry.previousPages, registryRead, registryVersion]);

  // Hoist Decision 11 spread-existence booleans for shared use across gesture +
  // wheel-handler registration.
  const hasNextSpread = spreadGeometry.nextPages.length > 0;
  const hasPreviousSpread = spreadGeometry.previousPages.length > 0;

  // --- usePageCurlGesture ---
  usePageCurlGesture({
    enabled,
    stageRef,
    overlayRef,
    overlayRect,
    pageWidth,
    pageHeight,
    actions,
    useDualCoordinates: resolvedViewMode === 'dual-cover',
    hasNextSpread,
    hasPreviousSpread,
    nextBitmapReady,
    prevBitmapReady,
  });

  // --- Wheel-handler registration (Decision 11) ---
  // FlipbookProvider owns the wheel listener (always-mounted); curl plugs in via
  // this callback. The handler is a thin wrapper over `decideCurlWheelDispatch`
  // (pure-function extraction for testability). All gate logic (animating,
  // cooldown, direction preconditions, bitmap readiness) lives in the pure
  // function; `wheelDecision.test.ts` covers it with table-driven inputs.
  // This wrapper just feeds live values and applies the decision.
  const lastWheelRef = useRef<number>(-Infinity);
  useEffect(() => {
    if (!enabled) return;

    const handler = (direction: 'next' | 'previous'): void => {
      const decision = decideCurlWheelDispatch({
        direction,
        isAnimating: actions.isAnimating(),
        hasNextSpread,
        hasPreviousSpread,
        nextBitmapReady,
        prevBitmapReady,
        lastWheelTimestamp: lastWheelRef.current,
        now: performance.now(),
        cooldownMs: WHEEL_THROTTLE_MS,
      });
      if (decision.fire) {
        // No non-null assertion needed — `CurlWheelDecision` is a discriminated
        // union on `fire`, so tsc narrows `decision` to
        // `{ fire: true; newLastWheelTimestamp: number }` inside this branch.
        lastWheelRef.current = decision.newLastWheelTimestamp;
        actions.startAnimatedCurl(direction);
      }
    };

    registerCurlWheelHandler(handler);
    return () => registerCurlWheelHandler(null);
  }, [
    enabled,
    registerCurlWheelHandler,
    actions,
    hasNextSpread,        // required to refresh the registered closure when
    hasPreviousSpread,    //   spread-existence flips (e.g., SOURCE_CHANGED
    nextBitmapReady,      //   action shifts page count).
    prevBitmapReady,
  ]);

  // --- Cancellation triggers (Decision 18) ---
  // Each trigger does two things:
  //   1. Bump cancelSignalRef so rAF ticks already queued read the new value and short-circuit.
  //   2. Call actions.cancel() for synchronous teardown.
  // Order: bump first, then cancel.
  const prevEnabledRef = useRef(enabled);
  const prevViewModeRef = useRef(resolvedViewMode);
  const prevSourceRef = useRef(source);
  const prevEffectiveScaleRef = useRef(effectiveScale);

  useEffect(() => {
    const enabledChanged = prevEnabledRef.current !== enabled;
    const viewModeChanged = prevViewModeRef.current !== resolvedViewMode;
    const sourceChanged = prevSourceRef.current !== source;
    // effectiveScale transitions (from wheel zoom, toolbar SET_ZOOM, OR container
    // resize for fit modes) cancel in-flight curl. Without this, a mid-curl zoom
    // that doesn't trip isOverflowing leaves the animation reading stale
    // pageWidth/pageHeight derived from the old effectiveScale → undefined visual
    // behavior. Initial transition from loading-default (1) to first real
    // measurement is a no-op because no curl is in-flight at that moment.
    const effectiveScaleChanged = prevEffectiveScaleRef.current !== effectiveScale;

    prevEnabledRef.current = enabled;
    prevViewModeRef.current = resolvedViewMode;
    prevSourceRef.current = source;
    prevEffectiveScaleRef.current = effectiveScale;

    const shouldBump = (enabledChanged && !enabled) || viewModeChanged || sourceChanged || effectiveScaleChanged;

    if (shouldBump) {
      // cancelSignal++ aborts any in-flight rAF (animation states) — animations
      // read the counter each frame and short-circuit on mismatch.
      cancelSignalRef.current++;
      // actions.cancel() is called UNCONDITIONALLY — matches the pre-existing
      // cancellation convention for enabled/viewMode/source changes (Step 3 work).
      //
      // Why unconditional: cancelSignal only handles rAF-driven states (HOVERING
      // animation loop, ANIMATING snap-back/commit). It does NOT handle DRAGGING —
      // drag is pointer-event-driven, not rAF-driven, so the per-frame cancelSignal
      // check never executes during a drag. Only actions.cancel() can reset drag
      // state. Mid-drag zoom MUST call cancel() to abort the drag cleanly; otherwise
      // the drag continues with stale pageWidth (toPageLocal transform reads new
      // pageWidth via liveParamsRef → curl coords compute against new geometry →
      // visual jump). Gating on isAnimating() would skip cancel() during drag.
      //
      // If cancel() from idle proves expensive in profiling (it shouldn't — well-
      // designed state machines are idempotent from terminal states), the fix
      // belongs INSIDE useCurlAnimation (make cancel() idempotent from idle), NOT
      // in this invocation site.
      actions.cancel();
    }
  }, [enabled, resolvedViewMode, source, effectiveScale, actions]);

  // --- Page Visibility (Decision 20) ---
  useEffect(() => {
    if (typeof document === 'undefined') return;
    function onVisibilityChange(): void {
      if (document.visibilityState === 'hidden') {
        cancelSignalRef.current++;
        actions.cancel();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [actions]);

  return { snapshot, actions, getCancelSignal };
};
