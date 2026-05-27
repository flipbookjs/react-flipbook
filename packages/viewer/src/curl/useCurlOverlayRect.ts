import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PageRegistryRead } from '../core/PageRegistry';
import type { SpreadGeometry } from './spreadGeometry';

export interface OverlayRect {
  /** Stage-local left in CSS pixels (matches canvas inline-style left). */
  left: number;
  /** Stage-local top in CSS pixels. */
  top: number;
  /** Width in CSS pixels. */
  width: number;
  /** Height in CSS pixels. */
  height: number;
  /** Viewport-space rect (clientX-compatible) — for gesture hit-test transforms. */
  viewportRect: DOMRect;
}

export interface UseCurlOverlayRectParams {
  stageRef: RefObject<HTMLDivElement | null>;
  spreadGeometry: SpreadGeometry;
  registryRead: PageRegistryRead;
  /** Memoization signal — recompute when the registry version changes. */
  registryVersion: number;
  /** Resolved view mode — gates solo-spread expansion (dual-cover only). */
  resolvedViewMode: 'single' | 'dual-cover';
}

/**
 * Measures the overlay rect from the union of currently-registered page elements.
 *
 * Solo-spread expansion (dual-cover only): cover-shape extends overlay leftward by
 * the visible page's width so the canvas covers both halves of the book; last-solo
 * extends rightward by the same amount. Single mode never expands.
 *
 * Returns null when the stage isn't mounted, the current spread has no pages, or
 * none of the current spread's pages have registered yet.
 */
export const useCurlOverlayRect = (params: UseCurlOverlayRectParams): OverlayRect | null => {
  const { stageRef, spreadGeometry, registryRead, registryVersion, resolvedViewMode } = params;
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);

  const remeasure = useCallback((): void => {
    const stage = stageRef.current;
    if (!stage || spreadGeometry.currentPages.length === 0) {
      setOverlayRect(null);
      return;
    }

    const stageRectViewport = stage.getBoundingClientRect();
    let unionLeft = Infinity;
    let unionTop = Infinity;
    let unionRight = -Infinity;
    let unionBottom = -Infinity;

    for (const pageIndex of spreadGeometry.currentPages) {
      const entry = registryRead.get(pageIndex);
      if (!entry?.element) continue;
      const pageRectViewport = entry.element.getBoundingClientRect();
      unionLeft = Math.min(unionLeft, pageRectViewport.left);
      unionTop = Math.min(unionTop, pageRectViewport.top);
      unionRight = Math.max(unionRight, pageRectViewport.right);
      unionBottom = Math.max(unionBottom, pageRectViewport.bottom);
    }

    if (unionLeft === Infinity) {
      setOverlayRect(null);
      return;
    }

    let width = unionRight - unionLeft;
    let left = unionLeft - stageRectViewport.left;
    const height = unionBottom - unionTop;
    const top = unionTop - stageRectViewport.top;

    if (resolvedViewMode === 'dual-cover' && spreadGeometry.currentSoloShape !== null) {
      if (spreadGeometry.currentSoloShape === 'cover') {
        left -= width;
        width *= 2;
      } else {
        // 'last-solo' (narrowed by the outer null check + 'cover' branch)
        width *= 2;
      }
    }

    const viewportRect = new DOMRect(
      stageRectViewport.left + left,
      stageRectViewport.top + top,
      width,
      height,
    );

    setOverlayRect({ left, top, width, height, viewportRect });
  }, [
    stageRef,
    spreadGeometry.currentPages,
    spreadGeometry.currentSoloShape,
    registryRead,
    registryVersion,
    resolvedViewMode,
  ]);

  useLayoutEffect(() => {
    remeasure();
  }, [remeasure]);

  // Stable ResizeObserver: subscribe once on mount, read remeasure via ref so the
  // observer callback always calls the latest function. Without the ref indirection,
  // every spread/registry change would re-subscribe the observer.
  const remeasureRef = useRef(remeasure);
  remeasureRef.current = remeasure;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      remeasureRef.current();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageRef]);

  return overlayRect;
};
