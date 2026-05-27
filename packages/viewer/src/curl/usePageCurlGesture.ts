// No 'use client' directive — see useCurlAnimation.ts file header note.

import { useEffect, useRef, type RefObject } from 'react';
import { type Point } from './CurlCalculation';
import { type CurlAnimationActions } from './useCurlAnimation';
import { curlAssert } from './types';

// RefObject is consumed by UsePageCurlGestureParams (stageRef + overlayRef).
// Even though the interface lives in §4.A, this file is the authoritative source
// of truth — RefObject must be imported here.

const CORNER_ZONE_RADIUS = 80; // px — preserved from old fork usePageCurlGesture.ts:13
const WHEEL_COOLDOWN_MS = 150; // preserved from old fork

// Tap-to-curl behavior. When the pointer moves less than this distance between
// pointerdown and pointerup, the gesture is treated as a tap (click) on the
// corner instead of a zero-distance drag. A zero-distance drag would have
// progress < commitThreshold and spring back to flat — i.e. click-on-corner
// would do nothing. Tap detection routes those interactions through
// startAnimatedCurl instead, matching user expectation that "click the corner
// to flip the page". The architectural plan's Checklist item 13 names this
// behavior; neither the old fork nor 3A/3B implemented it. Added 3C Phase 4.5.
const TAP_MOVE_THRESHOLD_PX = 5;

/** Parameters useCurlMode passes to usePageCurlGesture. */
export interface UsePageCurlGestureParams {
  /** Mirrors the animation hook's enabled flag. False → no listeners attached. */
  enabled: boolean;
  /** Stage container (`.fbjs-stage` div) — listeners attach here. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** Overlay canvas ref — target for pointer capture. */
  overlayRef: RefObject<HTMLCanvasElement | null>;
  /**
   * Bounding rect of the overlay in VIEWPORT coordinates (same space as
   * `event.clientX/Y`). MUST be the result of `overlay.getBoundingClientRect()`
   * — NOT `ResizeObserver.entry.contentRect`, which is element-local and would
   * produce wrong client→local subtractions. 3B's CurlOverlay uses a ResizeObserver
   * to trigger a re-measurement and a window scroll listener; the value passed
   * here is `overlay.getBoundingClientRect()` from the latest measurement.
   */
  overlayRect: DOMRect | null;
  /** Single-page width/height in CSS pixels at current scale. Same values passed to useCurlAnimation. */
  pageWidth: number;
  pageHeight: number;
  /** Stable animation actions from useCurlAnimation. */
  actions: CurlAnimationActions;
  /** True in dual-cover view mode — controls the directional coordinate transform. */
  useDualCoordinates: boolean;
  /** Decision 11 preconditions — useCurlMode computes from PageRegistry + spreads array. */
  hasNextSpread: boolean;
  hasPreviousSpread: boolean;
  /** Whether the next-spread page canvas is in the PageRegistry. */
  nextBitmapReady: boolean;
  /** Whether the previous-spread page canvas is in the PageRegistry. */
  prevBitmapReady: boolean;
}

// Preserved verbatim from old fork usePageCurlGesture.ts:78.
type Corner = 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left' | null;

// Preserved verbatim from old fork usePageCurlGesture.ts:80-115.
const hitTestCorner = (
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Corner => {
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;

  // Top-right corner
  if (
    Math.hypot(relX - rect.width, relY) <= CORNER_ZONE_RADIUS
  ) {
    return 'top-right';
  }
  // Bottom-right corner
  if (
    Math.hypot(relX - rect.width, relY - rect.height) <= CORNER_ZONE_RADIUS
  ) {
    return 'bottom-right';
  }
  // Top-left corner
  if (
    Math.hypot(relX, relY) <= CORNER_ZONE_RADIUS
  ) {
    return 'top-left';
  }
  // Bottom-left corner
  if (
    Math.hypot(relX, relY - rect.height) <= CORNER_ZONE_RADIUS
  ) {
    return 'bottom-left';
  }

  return null;
};

// Preserved verbatim from old fork usePageCurlGesture.ts:118-123.
// PR3 override: bottom corners only (v1). Top corners fall through to
// normal DOM interaction. Master plan maps all 4 corners.
const cornerToDirection = (corner: Corner): 'next' | 'previous' | null => {
  if (corner === 'bottom-right') return 'next';
  if (corner === 'bottom-left') return 'previous';
  return null; // top corners ignored in v1
};

export const usePageCurlGesture = (params: UsePageCurlGestureParams): void => {
  // pageHeight is declared in the interface for symmetry with useCurlAnimation's
  // params and to leave room for future hit-test code that needs vertical metrics —
  // but no current code path reads it. Don't destructure; would fail strict
  // unused-binding lint rules.
  const { enabled, stageRef } = params;

  // All OTHER mutable params (overlayRect, overlayRef, pageWidth, actions,
  // useDualCoordinates, hasNextSpread/PreviousSpread, nextBitmapReady/prevBitmapReady)
  // are NOT destructured. They live in `liveParamsRef`, synced render-time. Why:
  // the gesture useEffect's dep array MUST be narrow (only `[enabled, stageRef]`)
  // to avoid tearing down listeners mid-drag when an unrelated prop flips. Realistic
  // scenario: user is dragging the right page when the next-spread bitmap finishes
  // loading; `nextBitmapReady` flips true; if it were in the deps, cleanup would
  // run, release pointer capture, and kill the drag. Reading via the ref keeps
  // handlers always-fresh AND keeps the listener attachment stable.
  const liveParamsRef = useRef<UsePageCurlGestureParams>(params);
  liveParamsRef.current = params;

  // Active pointer tracking. Replaces old fork's isDraggingRef boolean —
  // pointerId-based gating handles multi-touch correctly (stray pointers
  // from a second finger can't trigger pointerup/cancel for the active drag).
  const activePointerIdRef = useRef<number | null>(null);

  // Active curl direction — set in handlePointerDown after corner hit-test;
  // read by handlePointerMove/handlePointerUp to drive toPageLocal transform.
  // Mirrors old fork's directionRef pattern.
  const directionRef = useRef<'next' | 'previous' | null>(null);

  // Tap detection: pointerdown coords stored for the no-movement check in
  // pointerup. Cleared in pointerup, pointercancel, and unmount cleanup.
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  // Wheel cooldown timestamp. Preserved from old fork.
  // Initialized to -Infinity so the FIRST wheel event is never swallowed by the cooldown.
  // (Using 0 would swallow the first event when performance.now() is < 150ms — happens in
  // fake-timer tests that start at 0, and possible in real runtime if a wheel arrives
  // within the first 150ms of page load.)
  const lastWheelRef = useRef<number>(-Infinity);

  // Hover state. Preserved from old fork — used by handleHoverPointerMove.
  const isHoveringCornerRef = useRef<boolean>(false);

  // Window-level pointerup/pointercancel fallback for the rare case where
  // setPointerCapture throws (unsupported browser / jsdom-like env). Without
  // capture, the user can release outside the stage and `pointerup` never fires
  // on the stage element — leaving `activePointerIdRef` permanently set and
  // soft-locking the curl feature. This ref stores the listener function so it
  // can be removed when normal pointerup/cancel fires or the hook unmounts.
  const windowPointerUpFallbackRef = useRef<((e: PointerEvent) => void) | null>(null);

  const handleHoverPointerMove = (event: PointerEvent): void => {
    const { actions, overlayRect, hasNextSpread, hasPreviousSpread, nextBitmapReady, prevBitmapReady } = liveParamsRef.current;

    // Don't show hover hint during an active drag or animation.
    if (activePointerIdRef.current !== null) return;
    if (actions.isAnimating()) return;

    const rect = overlayRect ?? stageRef.current?.getBoundingClientRect();
    if (!rect) return;

    const corner = hitTestCorner(event.clientX, event.clientY, rect);
    const direction = cornerToDirection(corner);

    // Gate on Decision 11 preconditions — no hover hint when the curl couldn't happen anyway.
    const validNext = direction === 'next' && hasNextSpread && nextBitmapReady;
    const validPrev = direction === 'previous' && hasPreviousSpread && prevBitmapReady;
    const isOverActiveCorner = validNext || validPrev;

    if (isOverActiveCorner && !isHoveringCornerRef.current) {
      isHoveringCornerRef.current = true;
      actions.startHover(direction!);
    } else if (!isOverActiveCorner && isHoveringCornerRef.current) {
      isHoveringCornerRef.current = false;
      actions.endHover();
    }
  };

  // Convert clientX/clientY → overlay-local using the cached viewport rect.
  // `overlayRect` must come from overlay.getBoundingClientRect(); ResizeObserver
  // may trigger re-measurement in 3B, but its contentRect is NOT used here.
  // Fall back to stageRef.getBoundingClientRect() for early-mount / test.
  // Replaces old fork's getViewportOverlayRect() / scroll-aware chain.
  const toOverlayLocal = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const { overlayRect } = liveParamsRef.current;
    const rect = overlayRect ?? stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // PRESERVED VERBATIM from old fork usePageCurlGesture.ts:61-76.
  // The directional transform is load-bearing — without it, dual-spread next
  // curls and ALL previous curls produce wrong geometry.
  // Note: old fork's 'previous' branch is unified — `pageWidth - overlayX`
  // applies in BOTH single and dual mode (mirror x regardless of coordinate mode).
  const toPageLocal = (
    overlayX: number,
    overlayY: number,
    direction: 'next' | 'previous',
    pageWidth: number,
    useDualCoordinates: boolean,
  ): Point => {
    if (direction === 'next' && useDualCoordinates) {
      return { x: overlayX - pageWidth, y: overlayY };
    }
    if (direction === 'next') {
      return { x: overlayX, y: overlayY };
    }
    // 'previous': always mirror x regardless of coordinate mode
    return { x: pageWidth - overlayX, y: overlayY };
  };

  // Used by pointerup, pointercancel, and the unmount cleanup.
  // Capture target is the OVERLAY (matches old fork usePageCurlGesture.ts:206+278).
  const releaseOverlayCapture = (pointerId: number): void => {
    const overlay = liveParamsRef.current.overlayRef.current;
    if (!overlay) return;
    // Silent catch (Rule 1 exception, documented): release is a best-effort cleanup
    // operation. releasePointerCapture throws InvalidStateError if the pointer
    // wasn't actually captured (e.g., setPointerCapture earlier threw, browser
    // released it on tab-blur, element detached). In all those cases the desired
    // state — "no longer capturing this pointer" — is already true; logging the
    // exception would just create noise during normal cleanup.
    try { overlay.releasePointerCapture(pointerId); } catch { /* expected; see comment above */ }
  };

  // Remove the window-level pointerup fallback if it was installed for a
  // capture-less drag. Idempotent: no-op when not installed. Called from
  // handlePointerUp, handlePointerCancel, and the useEffect cleanup.
  const clearWindowPointerUpFallback = (): void => {
    const fallback = windowPointerUpFallbackRef.current;
    if (!fallback) return;
    window.removeEventListener('pointerup', fallback);
    window.removeEventListener('pointercancel', fallback);
    windowPointerUpFallbackRef.current = null;
  };

  const handlePointerDown = (event: PointerEvent): void => {
    const { actions, overlayRect, overlayRef, pageWidth, useDualCoordinates,
            hasNextSpread, hasPreviousSpread, nextBitmapReady, prevBitmapReady } = liveParamsRef.current;

    // Busy-state guard (matches old fork usePageCurlGesture.ts:180). Without it,
    // a touch landing during the auto-animate phase would pass the activePointerIdRef
    // null check, startDrag would no-op (state !== idle/hovering), but we'd still
    // capture + assign activePointerIdRef for a drag that never started.
    if (actions.isAnimating()) return;

    // Multi-touch / re-entrant guard. Second pointer during active drag is ignored
    // (matches old fork's isDraggingRef-boolean single-pointer behavior).
    if (activePointerIdRef.current !== null) return;

    // Resolve hit-test rect. Prefer cached overlayRect; fall back to stageRef.
    const rect = overlayRect ?? stageRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Decision 11 precondition #1: corner hit-test. cornerToDirection returns
    // null for top corners in v0.1 (bottom-only curl).
    const corner = hitTestCorner(event.clientX, event.clientY, rect);
    const direction = cornerToDirection(corner);
    if (direction === null) return;

    // Decision 11 preconditions #2/#3/#4: target spread exists AND its bitmap is
    // in the registry. Gated by useCurlMode (3B) based on PageRegistry state.
    if (direction === 'next' && (!hasNextSpread || !nextBitmapReady)) return;
    if (direction === 'previous' && (!hasPreviousSpread || !prevBitmapReady)) return;

    // Preserved from old fork usePageCurlGesture.ts:190-191. Suppress native text
    // selection + downstream handlers (PDF annotation, link clicks, etc.). Only
    // called AFTER all preconditions pass — otherwise we'd swallow non-curl gestures.
    event.preventDefault();
    event.stopPropagation();

    // Lock direction so move/up/cancel apply the correct transform.
    directionRef.current = direction;

    // Record pointerdown position for tap detection in pointerup.
    pointerDownPosRef.current = { x: event.clientX, y: event.clientY };

    // Start the drag — useCurlAnimation captures its snapshot internally.
    actions.startDrag(direction);

    // **APPROVED DIVERGENCE from old fork (UX enhancement).** Old fork waits for
    // first pointermove to render the initial curl frame. This eager render at
    // pointerdown eliminates the "skip" on fast flick gestures (where pointerup
    // can arrive before a single pointermove fires) and makes tap-and-hold
    // immediately show the corner peel. Costs one extra calcCurl call per gesture.
    // Approved by user during house-rules review; should be backfilled into
    // step-3-architectural-plan.md as a documented Decision.
    const local = toOverlayLocal(event.clientX, event.clientY);
    if (local) {
      const pageLocal = toPageLocal(local.x, local.y, direction, pageWidth, useDualCoordinates);
      actions.updateDrag(pageLocal);
    }

    // Capture pointer on the OVERLAY (matches old fork :206). Overlay may be null
    // in tests / early mount — skip capture gracefully without bailing the gesture.
    let captureSucceeded = false;
    const overlay = overlayRef.current;
    if (overlay) {
      try {
        overlay.setPointerCapture(event.pointerId);
        captureSucceeded = true;
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[flipbook] setPointerCapture failed; gesture continues without capture', err);
        }
        // Don't bail — touch-action + corner-zone hit-test are belt-and-suspenders.
      }
    }

    // Track this pointer so pointermove/up/cancel can gate on it.
    // Assignment AFTER startDrag + capture so failed preconditions leave the ref null.
    activePointerIdRef.current = event.pointerId;

    // I1 fallback: without pointer capture, the user can release outside the
    // stage and pointerup never fires here — leaving activePointerIdRef set
    // forever (soft-locks the curl). Install a window-level pointerup/cancel
    // listener as a backstop. handlePointerUp/Cancel remove it if normal events
    // fire first; otherwise this fires and cleans up.
    if (!captureSucceeded) {
      const fallback = (e: PointerEvent): void => {
        if (activePointerIdRef.current !== e.pointerId) return;
        activePointerIdRef.current = null;
        directionRef.current = null;
        clearWindowPointerUpFallback();
        liveParamsRef.current.actions.cancel();
      };
      windowPointerUpFallbackRef.current = fallback;
      window.addEventListener('pointerup', fallback);
      window.addEventListener('pointercancel', fallback);
    }
  };

  const handlePointerMove = (event: PointerEvent): void => {
    // Gate on captured pointer id (not isAnimating — that would also fire during
    // auto-animate phase after pointerup, sending bogus updateDrag calls).
    if (activePointerIdRef.current !== event.pointerId) return;
    if (directionRef.current === null) return;
    const { actions, pageWidth, useDualCoordinates } = liveParamsRef.current;
    const local = toOverlayLocal(event.clientX, event.clientY);
    if (!local) return;
    const pageLocal = toPageLocal(local.x, local.y, directionRef.current, pageWidth, useDualCoordinates);
    // Old fork curlAssert at usePageCurlGesture.ts:261 — preserve finite check.
    curlAssert(
      isFinite(pageLocal.x) && isFinite(pageLocal.y),
      'gesture:pointerMove',
      'page-local coords are non-finite after transform',
      { overlayX: local.x, overlayY: local.y, pageLocalX: pageLocal.x, pageLocalY: pageLocal.y, direction: directionRef.current },
    );
    actions.updateDrag(pageLocal);
  };

  const handlePointerUp = (event: PointerEvent): void => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (directionRef.current === null) {
      activePointerIdRef.current = null;
      pointerDownPosRef.current = null;
      releaseOverlayCapture(event.pointerId);
      clearWindowPointerUpFallback();
      return;
    }
    const { actions, pageWidth, useDualCoordinates } = liveParamsRef.current;

    // Tap detection: if the pointer moved less than TAP_MOVE_THRESHOLD_PX
    // between pointerdown and pointerup, treat as a click on the corner.
    // The zero-distance drag in progress has progress ≈ 0 (below
    // commitThreshold), so the normal endDrag path would spring back to flat.
    // Instead: cancel the drag cleanly, then trigger an animated curl.
    const downPos = pointerDownPosRef.current;
    pointerDownPosRef.current = null;
    if (downPos !== null) {
      const dx = event.clientX - downPos.x;
      const dy = event.clientY - downPos.y;
      if (Math.hypot(dx, dy) < TAP_MOVE_THRESHOLD_PX) {
        const tapDirection = directionRef.current;
        activePointerIdRef.current = null;
        directionRef.current = null;
        releaseOverlayCapture(event.pointerId);
        clearWindowPointerUpFallback();
        // cancel() returns the state machine to idle without dispatching;
        // startAnimatedCurl then begins a full animated curl from idle.
        actions.cancel();
        actions.startAnimatedCurl(tapDirection);
        return;
      }
    }

    // Send final updateDrag with the pointerup coords BEFORE endDrag, so endDrag's
    // threshold check sees fresh curlResultRef.progress. Old fork relied on a
    // prior pointermove having populated dragPointRef; this is more reliable.
    const local = toOverlayLocal(event.clientX, event.clientY);
    if (local) {
      const pageLocal = toPageLocal(local.x, local.y, directionRef.current, pageWidth, useDualCoordinates);
      actions.updateDrag(pageLocal);
    }

    activePointerIdRef.current = null;
    directionRef.current = null;
    releaseOverlayCapture(event.pointerId);
    clearWindowPointerUpFallback();
    actions.endDrag();
  };

  const handlePointerCancel = (event: PointerEvent): void => {
    if (activePointerIdRef.current !== event.pointerId) return;
    activePointerIdRef.current = null;
    directionRef.current = null;
    pointerDownPosRef.current = null;
    releaseOverlayCapture(event.pointerId);
    clearWindowPointerUpFallback();
    liveParamsRef.current.actions.cancel(); // no endDrag — cancellation aborts, never commits
  };

  // Preserved logic from old fork usePageCurlGesture.ts:238-247. Without this,
  // a hover peel can stay visible after the pointer exits the stage (no further
  // pointermove events fire to trigger the corner-zone-exit branch in
  // handleHoverPointerMove). Active drag is unaffected — only ends hover.
  const handlePointerLeave = (): void => {
    if (activePointerIdRef.current !== null) return; // drag in progress, leave it alone
    if (isHoveringCornerRef.current) {
      isHoveringCornerRef.current = false;
      liveParamsRef.current.actions.endHover();
    }
  };

  const handleWheel = (event: WheelEvent): void => {
    // preventDefault FIRST (preserved from old fork usePageCurlGesture.ts:288).
    // The stage owns wheel — rapid wheel events during animation / cooldown should
    // NOT scroll the page underneath. The listener is registered with
    // { passive: false } below to make preventDefault actually work.
    event.preventDefault();

    const { actions, hasNextSpread, hasPreviousSpread, nextBitmapReady, prevBitmapReady } = liveParamsRef.current;

    // Busy / cooldown gates (preserved from old fork).
    if (actions.isAnimating()) return;
    const now = performance.now();
    if (now - lastWheelRef.current < WHEEL_COOLDOWN_MS) return;

    // Max-magnitude axis (preserved from old fork usePageCurlGesture.ts:295).
    // Handles trackpad horizontal swipes that primarily produce deltaX.
    const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (dominantDelta === 0) return;

    const direction: 'next' | 'previous' = dominantDelta > 0 ? 'next' : 'previous';

    // Decision 11 preconditions also apply to wheel.
    if (direction === 'next' && (!hasNextSpread || !nextBitmapReady)) return;
    if (direction === 'previous' && (!hasPreviousSpread || !prevBitmapReady)) return;

    // Stamp the cooldown timer only when we actually fire a curl.
    lastWheelRef.current = now;
    actions.startAnimatedCurl(direction);   // CHANGED: drop the second commitFn arg
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !enabled) return;

    stage.addEventListener('pointerdown', handlePointerDown);
    stage.addEventListener('pointermove', handlePointerMove);
    stage.addEventListener('pointerup', handlePointerUp);
    stage.addEventListener('pointercancel', handlePointerCancel);
    stage.addEventListener('pointerleave', handlePointerLeave);
    stage.addEventListener('wheel', handleWheel, { passive: false });
    // Hover hint listener — preserved from old fork.
    stage.addEventListener('pointermove', handleHoverPointerMove);

    return () => {
      stage.removeEventListener('pointerdown', handlePointerDown);
      stage.removeEventListener('pointermove', handlePointerMove);
      stage.removeEventListener('pointerup', handlePointerUp);
      stage.removeEventListener('pointercancel', handlePointerCancel);
      stage.removeEventListener('pointerleave', handlePointerLeave);
      stage.removeEventListener('wheel', handleWheel);
      stage.removeEventListener('pointermove', handleHoverPointerMove);

      // Cleanup hover state if active — mirror handlePointerLeave logic.
      if (isHoveringCornerRef.current) {
        isHoveringCornerRef.current = false;
        liveParamsRef.current.actions.endHover();
      }

      // Release pointer capture if a drag is active (Decision 14 / P4).
      // Capture target is the OVERLAY — matches handlePointerDown.
      if (activePointerIdRef.current !== null) {
        releaseOverlayCapture(activePointerIdRef.current);
        activePointerIdRef.current = null;
        directionRef.current = null;
      }

      // Remove the window-level pointerup fallback if it was installed for a
      // capture-less drag (I1). Idempotent: no-op when not installed.
      clearWindowPointerUpFallback();
    };
    // Deps deliberately narrow: only `enabled` and `stageRef`. Other mutable
    // params (overlayRect, pageWidth, actions, useDualCoordinates,
    // hasNextSpread/PreviousSpread, nextBitmapReady/prevBitmapReady) are read
    // via liveParamsRef inside the handlers — keeping them OUT of the dep array
    // means listeners stay attached when those values change mid-drag. A change
    // to nextBitmapReady while the user is dragging the next page (realistic if
    // the bitmap finishes loading mid-gesture) would otherwise tear down listeners
    // and kill the drag.
  }, [enabled, stageRef]);
};
