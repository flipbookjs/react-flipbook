'use client';

import { useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useFlipbookContext } from '../core/FlipbookContext';
import { PageRegistryReadContext } from '../core/PageRegistry';
import { deriveSpreadGeometry } from './spreadGeometry';
import { useCurlMode } from './useCurlMode';
import { useCurlOverlayRect } from './useCurlOverlayRect';
import { useCurlRenderCallback } from './useCurlRenderCallback';

interface CurlOverlayProps {
  /** Stage container ref from FlipbookProvider — gesture listeners attach here. */
  stageRef: RefObject<HTMLDivElement | null>;
}

/**
 * CurlOverlay — full rewrite per Decision 5.
 *
 * Mounted conditionally by FlipbookProvider (via React.lazy + Suspense) ONLY when
 * `enablePageCurl && showContent && !isOverflowing && !prefersReducedMotion` — in
 * both single-page and dual-cover view modes. When this component renders, those
 * preconditions are guaranteed by the caller. The internal `enabled` flag for
 * useCurlMode is therefore tied only to `!degraded`.
 *
 * Hook order (linear, no cycles):
 *   1. spreadGeometry — derived from FlipbookContext (pure)
 *   2. overlayRect    — measured from registry + spreadGeometry
 *   3. useCurlMode    — wires animation + gesture (receives fresh overlayRect)
 *   4. useCurlRenderCallback — per-frame paint (receives all upstream values)
 */
function CurlOverlay({ stageRef }: CurlOverlayProps) {
  const { state, spreads } = useFlipbookContext();
  const { resolvedViewMode, currentSpreadIndex } = state;

  // PageRegistry read context. Caller guarantees presence; explicit error if absent.
  // The dev-mode console.error is critical: CurlChunkErrorBoundary catches the throw
  // and renders null, which would otherwise SILENCE a real developer mistake (provider
  // missing in tree) and make it look like a chunk-load failure. The console.error
  // surfaces the specific root cause loudly in development.
  const registryRead = useContext(PageRegistryReadContext);
  if (!registryRead) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[flipbook] CurlOverlay rendered without PageRegistryReadContext — '
        + 'this is a developer error (provider missing in tree). Curl will be disabled.',
      );
    }
    throw new Error('CurlOverlay requires PageRegistryReadContext');
  }

  const registryVersion = useSyncExternalStore(
    registryRead.subscribe,
    registryRead.getSnapshot,
    registryRead.getServerSnapshot,
  );

  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [degraded, setDegraded] = useState(false);

  // Callback ref for the overlay canvas. Fires atomically when React mounts the
  // canvas element. This is the right hook for degraded-mode detection because:
  //
  //   - On the first render overlayRect is null (no pages registered yet), the
  //     component returns null, and no canvas exists in the DOM yet.
  //   - On a later render (after pages register), overlayRect populates and the
  //     canvas mounts. The callback ref fires HERE — exactly when `getContext`
  //     can be probed for the first time.
  //
  // A `useLayoutEffect` with empty deps would have missed this second render's
  // mount entirely. Using `[overlayRect]` deps would re-run on every measurement
  // change (many during initial load). Callback ref is precise.
  //
  // setDegraded(true) bails idempotently if already true, so re-mount cycles are safe.
  // Any first-commit listener attachment is harmless because: (a) useCurlRenderCallback's
  // render closure inspects getContext per-frame and no-ops on null; (b) once
  // degraded flips true, useCurlRenderCallback's effect (deps `[actions, degraded]`)
  // unregisters the callback.
  const setOverlayCanvas = useCallback((el: HTMLCanvasElement | null) => {
    overlayRef.current = el;
    if (el && !el.getContext('2d')) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[flipbook] CurlOverlay canvas context unavailable; curl disabled (graceful degradation)');
      }
      setDegraded(true);
    }
  }, []);

  // 1. spreadGeometry — pure derivation, memoized for stability.
  const spreadGeometry = useMemo(
    () => deriveSpreadGeometry(spreads, currentSpreadIndex),
    [spreads, currentSpreadIndex],
  );

  // 2. overlayRect — measured against the stage + registry, expanded for solo spreads.
  const overlayRect = useCurlOverlayRect({
    stageRef,
    spreadGeometry,
    registryRead,
    registryVersion,
    resolvedViewMode,
  });

  // 3. useCurlMode — receives FRESH overlayRect for gesture coords. No ref dance.
  const { snapshot, actions } = useCurlMode({
    enabled: !degraded,
    stageRef,
    overlayRef,
    overlayRect: overlayRect?.viewportRect ?? null,
    spreadGeometry,
    registryRead,
    registryVersion,
  });

  // 4. Per-frame render callback + idle spine paint.
  useCurlRenderCallback({
    stageRef,
    overlayRef,
    actions,
    snapshot,
    overlayRect,
    spreadGeometry,
    registryRead,
    resolvedViewMode,
    degraded,
  });

  if (!overlayRect) return null;

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const dataActive = snapshot.state !== 'idle';

  return (
    <canvas
      ref={setOverlayCanvas}
      className="fbjs-curl-overlay"
      data-active={dataActive ? 'true' : undefined}
      width={overlayRect.width * dpr}
      height={overlayRect.height * dpr}
      style={{
        position: 'absolute',
        left: `${overlayRect.left}px`,
        top: `${overlayRect.top}px`,
        width: `${overlayRect.width}px`,
        height: `${overlayRect.height}px`,
      }}
    />
  );
}

export default CurlOverlay;
