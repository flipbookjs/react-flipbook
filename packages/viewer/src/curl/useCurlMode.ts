// No 'use client' directive — propagates from CurlOverlay.tsx (the boundary) per Decision 19.

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFlipbook } from '../core/FlipbookContext';
import { useCurlAnimation, type CurlAnimationSnapshot, type CurlAnimationActions } from './useCurlAnimation';
import { usePageCurlGesture } from './usePageCurlGesture';
import type { PageRegistryRead } from '../core/PageRegistry';
import type { SpreadGeometry } from './spreadGeometry';

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
  const { state, source, effectiveScale } = useFlipbook();
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
    hasNextSpread: spreadGeometry.nextPages.length > 0,
    hasPreviousSpread: spreadGeometry.previousPages.length > 0,
    nextBitmapReady,
    prevBitmapReady,
  });

  // --- Cancellation triggers (Decision 18) ---
  // Each trigger does two things:
  //   1. Bump cancelSignalRef so rAF ticks already queued read the new value and short-circuit.
  //   2. Call actions.cancel() for synchronous teardown.
  // Order: bump first, then cancel.
  const prevEnabledRef = useRef(enabled);
  const prevViewModeRef = useRef(resolvedViewMode);
  const prevSourceRef = useRef(source);

  useEffect(() => {
    const enabledChanged = prevEnabledRef.current !== enabled;
    const viewModeChanged = prevViewModeRef.current !== resolvedViewMode;
    const sourceChanged = prevSourceRef.current !== source;

    prevEnabledRef.current = enabled;
    prevViewModeRef.current = resolvedViewMode;
    prevSourceRef.current = source;

    const shouldBump = (enabledChanged && !enabled) || viewModeChanged || sourceChanged;

    if (shouldBump) {
      cancelSignalRef.current++;
      actions.cancel();
    }
  }, [enabled, resolvedViewMode, source, actions]);

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
