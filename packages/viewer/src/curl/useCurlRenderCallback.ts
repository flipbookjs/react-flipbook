import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { PageRegistryRead } from '../core/PageRegistry';
import { type CurlResult } from './CurlCalculation';
import { renderCurlFrame, drawSpineShadow, type PageBitmap } from './CurlRenderer';
import { curlAssert } from './types';
import type { OverlayRect } from './useCurlOverlayRect';
import type { CurlAnimationActions, CurlAnimationSnapshot } from './useCurlAnimation';
import type { SpreadGeometry } from './spreadGeometry';

export interface UseCurlRenderCallbackParams {
  stageRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  actions: CurlAnimationActions;
  snapshot: CurlAnimationSnapshot;
  overlayRect: OverlayRect | null;
  spreadGeometry: SpreadGeometry;
  registryRead: PageRegistryRead;
  resolvedViewMode: 'single' | 'dual-cover';
  /** True when the host has detected degraded mode — render callback never registers. */
  degraded: boolean;
}

/** Snapshot of every value the render closure needs. One ref, one read site. */
interface FrameContext {
  overlayRect: OverlayRect | null;
  spreadGeometry: SpreadGeometry;
  resolvedViewMode: 'single' | 'dual-cover';
  registryRead: PageRegistryRead;
  stageRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
}

export const useCurlRenderCallback = (params: UseCurlRenderCallbackParams): void => {
  const { stageRef, overlayRef, actions, snapshot, overlayRect, spreadGeometry, registryRead, resolvedViewMode, degraded } = params;

  // Single ref carrying every value the rAF closure needs. Sync render-time.
  const frameContextRef = useRef<FrameContext>({
    overlayRect, spreadGeometry, resolvedViewMode, registryRead, stageRef, overlayRef,
  });
  frameContextRef.current = { overlayRect, spreadGeometry, resolvedViewMode, registryRead, stageRef, overlayRef };

  // Per-frame render closure — registered once per [actions, degraded] tuple.
  // `actions` is referentially stable; `degraded` flips false → true on canvas-context
  // failure. When degraded becomes true on a later render, the previous effect's cleanup
  // unregisters the callback; the re-run early-returns and never re-registers.
  useEffect(() => {
    if (degraded) return;

    const renderFrame = (curl: CurlResult, direction: 'next' | 'previous'): void => {
      // Single try/catch around the entire per-frame work — per Decision 14, errors
      // from buildPageBitmap (canvas access during DOM unmount race) and renderCurlFrame
      // (corrupted clip-area, NaN coordinates) must be caught at the boundary and the
      // animation cancelled. Without this guard the throw escapes the rAF call to
      // window.onerror, and the next rAF tick re-invokes the same closure, producing
      // a tight error loop until the cancelSignal happens to bump.
      try {
        const ctx = frameContextRef.current;
        const canvas = ctx.overlayRef.current;
        if (!canvas) return;
        const c2d = canvas.getContext('2d');
        if (!c2d) return;

        const rect = ctx.overlayRect;
        if (!rect) return;

        const dpr = window.devicePixelRatio || 1;
        c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        c2d.clearRect(0, 0, rect.width, rect.height);

        const stage = ctx.stageRef.current;
        if (!stage) return;
        const stageRectViewport = stage.getBoundingClientRect();

        const geom = ctx.spreadGeometry;
        const adjacentPages = direction === 'next' ? geom.nextPages : geom.previousPages;
        const adjacentSoloShape = direction === 'next' ? geom.nextSoloShape : geom.previousSoloShape;

        const flippingPage = buildPageBitmap(
          ctx.registryRead,
          adjacentPages,
          direction === 'next' ? 'first' : 'last',
          stageRectViewport,
          rect,
        );
        const bottomPage = buildPageBitmap(
          ctx.registryRead,
          adjacentPages,
          direction === 'next' ? 'last' : 'first',
          stageRectViewport,
          rect,
        );
        const currentPageForPosition = buildPageBitmap(
          ctx.registryRead,
          geom.currentPages,
          direction === 'next' ? 'last' : 'first',
          stageRectViewport,
          rect,
        );

        const singlePageWidth = ctx.resolvedViewMode === 'dual-cover'
          ? rect.width / 2
          : rect.width;

        if (currentPageForPosition) {
          if (flippingPage) {
            flippingPage.offsetX = currentPageForPosition.offsetX;
            flippingPage.offsetY = currentPageForPosition.offsetY;
          }
          if (bottomPage) {
            bottomPage.offsetX = currentPageForPosition.offsetX;
            bottomPage.offsetY = currentPageForPosition.offsetY;
          }

          // Adjacent solo placement: cover-shape → right half; last-solo → left half.
          if (ctx.resolvedViewMode === 'dual-cover' && adjacentSoloShape !== null) {
            if (adjacentSoloShape === 'cover') {
              const soloOffsetX = currentPageForPosition.offsetX + singlePageWidth;
              if (flippingPage) flippingPage.offsetX = soloOffsetX;
              if (bottomPage) bottomPage.offsetX = soloOffsetX;
            } else if (adjacentSoloShape === 'last-solo') {
              if (flippingPage) flippingPage.offsetX = 0;
              if (bottomPage) bottomPage.offsetX = 0;
            }
          }
        }

        const mirrorX = direction === 'previous';
        const pageOriginInOverlay = ctx.resolvedViewMode === 'dual-cover'
          ? { x: singlePageWidth, y: 0 }
          : { x: direction === 'previous' ? singlePageWidth : 0, y: 0 };

        const spineWidth = ctx.resolvedViewMode === 'dual-cover'
          ? Math.max(8, rect.width / 40)
          : 0;

        renderCurlFrame({
          ctx: c2d,
          curl,
          flippingPage,
          bottomPage,
          overlayWidth: rect.width,
          overlayHeight: rect.height,
          pageWidth: singlePageWidth,
          pageHeight: rect.height,
          direction,
          pageOriginInOverlay,
          mirrorX,
          spineWidth,
        });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[flipbook] curl render frame threw; cancelling animation', err);
        }
        // actions.cancel() synchronously clears the state machine and stops further
        // rAF scheduling — no subsequent ticks re-invoke this closure with the same
        // bad inputs. This matches Decision 14: "animation cancels; overlay cleared".
        actions.cancel();
      }
    };

    actions.setRenderCallback(renderFrame);
    return () => actions.setRenderCallback(null);
  }, [actions, degraded]);

  // Idle-state spine shadow (Decision 5).
  useLayoutEffect(() => {
    if (degraded) return;
    if (snapshot.state !== 'idle') return;
    if (!overlayRect) return;
    // After a committed curl, the canvas already shows the final curl frame.
    // Don't overwrite it — the next gesture's render callback clears naturally.
    if (snapshot.committed) return;

    const canvas = overlayRef.current;
    if (!canvas) return;
    const c2d = canvas.getContext('2d');
    if (!c2d) return;

    const dpr = window.devicePixelRatio || 1;
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2d.clearRect(0, 0, overlayRect.width, overlayRect.height);

    if (resolvedViewMode === 'dual-cover') {
      const sw = Math.max(8, overlayRect.width / 40);
      c2d.save();
      c2d.translate(overlayRect.width / 2, 0);
      drawSpineShadow(c2d, sw, overlayRect.height);
      c2d.restore();
    }
  }, [snapshot.state, snapshot.committed, overlayRect, resolvedViewMode, degraded]);
};

/**
 * Build a PageBitmap for a specific page in a spread.
 *
 * Stage-local coords: `pageRect.left - stageRect.left` then subtract `overlayRect.left`
 * to get the bitmap's offset within the overlay's drawable area.
 *
 * Returns null when the registry entry is missing, the canvas has zero dimensions,
 * or no spread pages exist.
 */
function buildPageBitmap(
  registry: PageRegistryRead,
  spreadPages: number[],
  which: 'first' | 'last',
  stageRectViewport: DOMRect,
  overlayRect: OverlayRect,
): PageBitmap | null {
  if (spreadPages.length === 0) return null;
  const pageIndex = which === 'last'
    ? spreadPages[spreadPages.length - 1]
    : spreadPages[0];
  const entry = registry.get(pageIndex);
  if (!entry?.canvas || !entry?.element) return null;
  if (entry.canvas.width === 0 || entry.canvas.height === 0) return null;

  const pageRectViewport = entry.element.getBoundingClientRect();
  const bitmap: PageBitmap = {
    canvas: entry.canvas,
    offsetX: (pageRectViewport.left - stageRectViewport.left) - overlayRect.left,
    offsetY: (pageRectViewport.top - stageRectViewport.top) - overlayRect.top,
    width: pageRectViewport.width,
    height: pageRectViewport.height,
  };

  curlAssert(
    isFinite(bitmap.offsetX) && isFinite(bitmap.offsetY),
    'buildPageBitmap',
    'bitmap offset is non-finite — DOM layout may not be ready',
    { pageIndex, offsetX: bitmap.offsetX, offsetY: bitmap.offsetY },
  );
  curlAssert(
    bitmap.width > 0 && bitmap.height > 0,
    'buildPageBitmap',
    'bitmap has zero CSS dimensions',
    { pageIndex, width: bitmap.width, height: bitmap.height },
  );

  return bitmap;
}
