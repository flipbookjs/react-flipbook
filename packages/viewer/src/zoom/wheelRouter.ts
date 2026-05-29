import { increase as zoomIncrease, decrease as zoomDecrease } from './zoomingLevel';

/**
 * Pure function that decides what action to take for a wheel event in the
 * FlipbookProvider context. Extracted from FlipbookProvider's effect so the
 * load-bearing routing logic is unit-testable in isolation — table-driven
 * inputs and outputs, no React, no DOM, no mocks.
 *
 * Mirrors 5A's `deriveEffectiveScaleAndOverflow` pattern: load-bearing
 * branching logic lives in a pure function; the surrounding hook (`useWheelRouter`)
 * is a thin orchestrator that calls this and maps the returned action to side
 * effects (preventDefault on the event, dispatch SET_ZOOM, invoke curl callback).
 *
 * The returned `WheelRoute` discriminated union lets callers handle each case
 * exhaustively (tsc verifies the switch covers all kinds).
 */

export interface WheelRouteInputs {
  // Event-derived
  ctrlKey: boolean;
  metaKey: boolean;
  deltaX: number;
  deltaY: number;
  // Live state (refs at call site)
  isReady: boolean;
  isOverflowing: boolean;
  effectiveScale: number;
  hasCurlHandler: boolean;
  // Throttle state
  lastZoomTimestamp: number;
  now: number;
  throttleMs: number;
}

export type WheelRoute =
  /** No-op: do nothing, do NOT preventDefault (let browser handle scroll if any). */
  | { kind: 'noop' }
  /** Suppress browser zoom but do not dispatch — used during loading / throttle / zero-delta / cap. */
  | { kind: 'preventDefault-only' }
  /** Zoom dispatch: caller preventDefaults, updates lastZoomTimestamp to newTimestamp, dispatches SET_ZOOM with customScale. */
  | { kind: 'zoom'; customScale: number; newLastZoomTimestamp: number }
  /** Curl dispatch: caller preventDefaults, invokes the registered curl callback with direction. */
  | { kind: 'curl'; direction: 'next' | 'previous' };

export function routeWheelEvent(inputs: WheelRouteInputs): WheelRoute {
  const { ctrlKey, metaKey, deltaX, deltaY, isReady, isOverflowing,
          effectiveScale, hasCurlHandler, lastZoomTimestamp, now, throttleMs } = inputs;

  // Loading-state gate. Pre-isReady, suppress browser zoom on modifier
  // wheels but skip dispatch (otherwise the loading-default effectiveScale=1
  // would silently transition zoomMode → 'custom' on Ctrl+wheel during load,
  // breaking fit-page once content arrives). Non-modifier wheels are noop —
  // nothing to scroll yet; LoadingState is fixed-size.
  if (!isReady) {
    return (ctrlKey || metaKey) ? { kind: 'preventDefault-only' } : { kind: 'noop' };
  }

  // Case 1: Ctrl/Cmd + wheel → zoom.
  if (ctrlKey || metaKey) {
    // Zero-delta guard. Trackpad pinch-pause / momentum plateau can fire
    // deltaY=0 wheels. Without this guard, `deltaY < 0 ? 'in' : 'out'`
    // evaluates 'out' and stamps the throttle, dropping the next legitimate
    // Ctrl+wheel.
    if (deltaY === 0) return { kind: 'preventDefault-only' };
    // Leading-edge throttle.
    if (now - lastZoomTimestamp < throttleMs) return { kind: 'preventDefault-only' };
    const direction: 'in' | 'out' = deltaY < 0 ? 'in' : 'out';
    const next = direction === 'in' ? zoomIncrease(effectiveScale) : zoomDecrease(effectiveScale);
    // Same-value short-circuit: at the cap, increase(4) === 4. Skip dispatch
    // to avoid spurious re-renders. Relies on LEVELS ending at cap per
    // Decision 5 (verified in 5A zoomingLevel.test.ts).
    if (next === effectiveScale) return { kind: 'preventDefault-only' };
    return { kind: 'zoom', customScale: next, newLastZoomTimestamp: now };
  }

  // Case 2: overflowing → noop. CRITICAL: do NOT preventDefault; let browser scroll.
  if (isOverflowing) return { kind: 'noop' };

  // Case 3: curl handler registered → route to curl.
  if (hasCurlHandler) {
    // Max-magnitude axis (preserved from old fork) — trackpad horizontal swipes.
    const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
    if (dominantDelta === 0) return { kind: 'noop' };  // no axis to route
    return { kind: 'curl', direction: dominantDelta > 0 ? 'next' : 'previous' };
  }

  // Case 4: no curl, no overflow, no modifier → noop. Browser does nothing
  // (no scroll because content fits; no zoom because no modifier).
  return { kind: 'noop' };
}
