import { useEffect, type Dispatch, type MutableRefObject, type RefObject } from 'react';
import type { FlipbookAction } from '../core/flipbookReducer';
import { routeWheelEvent } from './wheelRouter';
import { WHEEL_THROTTLE_MS } from './wheelTiming';

/**
 * Hook that attaches a wheel listener to `containerRef.current` and orchestrates
 * the side effects returned by `routeWheelEvent`. Thin layer over the pure
 * routing function — extracted from FlipbookProvider so the listener setup
 * can be tested via `renderHook` with a controlled container element (no
 * FlipbookProvider mount required for the routing tests).
 *
 * Live-params pattern: all dynamic inputs are passed as refs that the caller
 * keeps in sync each render (see FlipbookProvider Phase 2.1 Edit B). The hook
 * attaches the listener once on mount with empty deps; the listener reads
 * fresh values via the refs each event. Without the ref pattern, every
 * effectiveScale / isOverflowing / isReady change would tear down and
 * re-attach the listener, briefly dropping events during the gap.
 *
 * ATTACHMENT TARGET: callers must pass `containerRef` (which must point to an
 * unconditionally-rendered element). `.fbjs-stage` is conditionally rendered
 * behind `showContent` and is NOT a valid attachment target — an empty-deps
 * effect keyed on `stageRef.current` would see null on initial render and
 * never re-attach (refs don't trigger re-renders). Container is unconditional,
 * so the listener fires once on mount with a non-null ref and stays attached.
 */

export interface UseWheelRouterParams {
  /** Genuinely-nullable: ref starts null until React attaches it. */
  containerRef: RefObject<HTMLElement | null>;
  /** Always-set refs (caller writes on every render — `MutableRefObject`'s
   *  non-nullable `.current` lets the hook trust the value without `??` defaults
   *  per house Rule 3). */
  isReadyRef: MutableRefObject<boolean>;
  isOverflowingRef: MutableRefObject<boolean>;
  effectiveScaleRef: MutableRefObject<number>;
  lastZoomTimestampRef: MutableRefObject<number>;
  /** Genuinely-nullable: initialized to null; useCurlMode toggles via
   *  registerCurlWheelHandler. */
  curlWheelHandlerRef: RefObject<((direction: 'next' | 'previous') => void) | null>;
  dispatch: Dispatch<FlipbookAction>;
}

export function useWheelRouter(params: UseWheelRouterParams): void {
  const {
    containerRef,
    isReadyRef,
    isOverflowingRef,
    effectiveScaleRef,
    curlWheelHandlerRef,
    lastZoomTimestampRef,
    dispatch,
  } = params;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent): void => {
      const route = routeWheelEvent({
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        isReady: isReadyRef.current,
        isOverflowing: isOverflowingRef.current,
        effectiveScale: effectiveScaleRef.current,
        hasCurlHandler: curlWheelHandlerRef.current !== null,
        lastZoomTimestamp: lastZoomTimestampRef.current,
        now: performance.now(),
        throttleMs: WHEEL_THROTTLE_MS,
      });

      switch (route.kind) {
        case 'noop':
          // Browser handles wheel naturally (scroll if overflowing; nothing if content fits).
          return;
        case 'preventDefault-only':
          event.preventDefault();
          return;
        case 'zoom':
          event.preventDefault();
          lastZoomTimestampRef.current = route.newLastZoomTimestamp;
          dispatch({ type: 'SET_ZOOM', mode: 'custom', customScale: route.customScale });
          return;
        case 'curl': {
          event.preventDefault();
          // Discriminant guarantees handler is non-null: routeWheelEvent only
          // returns kind='curl' when hasCurlHandler was true, and refs don't
          // mutate during a synchronous event handler. Non-null assertion is
          // the trust per house Rule 3.
          curlWheelHandlerRef.current!(route.direction);
          return;
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);
  // Empty deps intentional: all reads via refs (live-params pattern). Matches
  // FlipbookProvider's existing convention (e.g., the ResizeObserver effect at
  // lines 110-123 post-5A also uses empty deps without an eslint-disable
  // directive — the project's eslint config doesn't enable the react-hooks
  // plugin, so no exhaustive-deps rule is active and no disable directive is
  // needed.)
}
