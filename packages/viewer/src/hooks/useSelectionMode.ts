import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent, type RefObject } from 'react';
import { devWarn } from '../core/devWarn';
import type { FlipbookAction } from '../core/flipbookReducer';

const PAN_THRESHOLD = 4;

interface UseSelectionModeArgs {
  containerRef: RefObject<HTMLDivElement | null>;
  isOverflowing: boolean;
  interactionMode: 'select' | 'pan';
  dispatch: Dispatch<FlipbookAction>;
}

interface UseSelectionModeReturn {
  setInteractionMode: (mode: 'select' | 'pan') => void;
  isPanning: boolean;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
}

/**
 * Owns the pan-mode click-drag scroll handler. Gated on
 * `interactionMode === 'pan' && isOverflowing`. Returns the action body for
 * `setInteractionMode` plus the three pointer handlers to attach to the
 * container element.
 *
 * Drag-start threshold (PAN_THRESHOLD = 4): below 4px of movement before
 * pointerup, the gesture is treated as a click. Above the threshold, the
 * handler claims pointer capture and sets `isPanning=true` so CSS can swap
 * to `cursor: grabbing` via the `data-fbjs-panning="true"` attribute.
 *
 * Single-pointer guard: a drag is bound to its initiating pointerId via
 * `activePointerIdRef`. Concurrent touches/styli on a multi-touch surface
 * are ignored until the active drag terminates (pointerup or mode flip).
 *
 * Coordination with curl: pan and curl never coexist because their gates
 * disagree on `isOverflowing` — pan is active only when `isOverflowing=true`,
 * curl is active only when `isOverflowing=false`. No DOM-level `e.target`
 * inspection is needed or performed.
 */
export function useSelectionMode({
  containerRef,
  isOverflowing,
  interactionMode,
  dispatch,
}: UseSelectionModeArgs): UseSelectionModeReturn {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  // startScrollX/Y are scratch storage — only read inside the pointermove
  // handler when activePointerIdRef matches (i.e., a drag is in progress).
  // Cleanup paths don't reset them; they're overwritten on the next
  // pointerdown. Treated as garbage when not panning.
  const startScrollX = useRef<number>(0);
  const startScrollY = useRef<number>(0);
  const panStarted = useRef<boolean>(false);
  // Single-pointer guard (mirrors curl's usePageCurlGesture pattern). Stores
  // the pointerId of the drag in progress so a concurrent second touch or
  // stylus doesn't hijack the drag deltas or terminate it prematurely.
  const activePointerIdRef = useRef<number | null>(null);
  // Window-level outside-release backstop. Mirrors curl's I1-fallback at
  // usePageCurlGesture.ts:313. If pointerup/cancel fires outside the
  // container (pre-threshold pointer exit OR post-threshold capture
  // failure), the container-level handler never runs and activePointerIdRef
  // would stay set forever — soft-locking pan because the pointerdown guard
  // refuses subsequent drags. This ref holds the installed window listener
  // so the container-level pointerup can remove it before normal cleanup,
  // preventing double-execution.
  const windowPointerUpFallbackRef = useRef<((e: globalThis.PointerEvent) => void) | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const clearWindowPointerUpFallback = () => {
    const fallback = windowPointerUpFallbackRef.current;
    if (fallback === null) return;
    window.removeEventListener('pointerup', fallback);
    window.removeEventListener('pointercancel', fallback);
    windowPointerUpFallbackRef.current = null;
  };

  const setInteractionMode = useCallback(
    (mode: 'select' | 'pan') => {
      dispatch({ type: 'SET_INTERACTION_MODE', value: mode });
    },
    [dispatch],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (interactionMode !== 'pan' || !isOverflowing) return;
      if (e.button !== 0) return;
      // Multi-touch / re-entrant guard: a drag is already in progress from a
      // different pointer. Ignore this one (matches curl's pattern).
      if (activePointerIdRef.current !== null) return;
      const container = containerRef.current;
      if (container === null) return;
      // No e.target inspection: pan's (interactionMode + isOverflowing)
      // gate and curl's (enablePageCurl + !isOverflowing) gate disagree on
      // isOverflowing, so curl and pan can't both be active at the same
      // instant. State-level coordination, no DOM-level inspection needed.
      activePointerIdRef.current = e.pointerId;
      startX.current = e.clientX;
      startY.current = e.clientY;
      startScrollX.current = container.scrollLeft;
      startScrollY.current = container.scrollTop;
      panStarted.current = false;

      // Install the outside-release backstop. Catches the cases where the
      // container-level pointerup never fires: pre-threshold pointer exit
      // (no capture set), capture failure followed by drag-out, or any
      // browser anomaly. Without this, activePointerIdRef stays set forever
      // and the pointerdown guard above soft-locks future drags.
      const fallback = (we: globalThis.PointerEvent) => {
        if (we.pointerId !== activePointerIdRef.current) return;
        if (panStarted.current) {
          try {
            containerRef.current?.releasePointerCapture(we.pointerId);
          } catch (err) {
            devWarn('[flipbook] releasePointerCapture failed in outside-release backstop; ignoring', err);
          }
          setIsPanning(false);
          panStarted.current = false;
        }
        startX.current = null;
        startY.current = null;
        activePointerIdRef.current = null;
        clearWindowPointerUpFallback();
      };
      windowPointerUpFallbackRef.current = fallback;
      window.addEventListener('pointerup', fallback);
      window.addEventListener('pointercancel', fallback);
    },
    [interactionMode, isOverflowing, containerRef],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      // Single-pointer guard: ignore moves from any pointerId that didn't
      // initiate this drag.
      if (e.pointerId !== activePointerIdRef.current) return;
      // Mid-drag mode-flip release: if a drag is in progress (panStarted)
      // but interactionMode flipped away from 'pan' between renders, end the
      // drag cleanly here rather than waiting for pointerup. The startX/Y
      // null-resets + activePointerIdRef clear below also ensure subsequent
      // pointermoves hit the activePointerIdRef early-return above — preventing
      // any re-entry into the scroll path after the release completes.
      if (interactionMode !== 'pan' || !isOverflowing) {
        if (panStarted.current) {
          try {
            containerRef.current?.releasePointerCapture(e.pointerId);
          } catch (err) {
            // Symmetrical swallow — see the matching setPointerCapture below.
            devWarn('[flipbook] releasePointerCapture failed during mid-drag mode flip; ignoring', err);
          }
          setIsPanning(false);
          panStarted.current = false;
          startX.current = null;
          startY.current = null;
          activePointerIdRef.current = null;
          clearWindowPointerUpFallback();
        }
        return;
      }
      if (startX.current === null || startY.current === null) return;
      const container = containerRef.current;
      if (container === null) return;
      const dx = e.clientX - startX.current;
      const dy = e.clientY - startY.current;
      if (!panStarted.current) {
        if (Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) return;
        panStarted.current = true;
        try {
          container.setPointerCapture(e.pointerId);
        } catch (err) {
          // setPointerCapture throws InvalidStateError per spec when the
          // pointerId is not actively captured (e.g., the pointer was
          // released between pointerdown and the threshold crossing).
          // Capture is a UX nicety (prevents accidental drag exit on
          // fast moves) — swallow and continue scrolling without it.
          devWarn('[flipbook] setPointerCapture failed; pan continues without capture', err);
        }
        setIsPanning(true);
        e.preventDefault();
      }
      container.scrollLeft = startScrollX.current - dx;
      container.scrollTop = startScrollY.current - dy;
    },
    [interactionMode, isOverflowing, containerRef],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      // Single-pointer guard: ignore up/cancel from any pointerId that didn't
      // initiate this drag. Prevents a second touch's pointerup from clearing
      // the active drag's state.
      if (e.pointerId !== activePointerIdRef.current) return;
      // Remove the window backstop BEFORE the rest of cleanup. If the
      // backstop fired first, it already cleared activePointerIdRef and the
      // single-pointer guard above would have returned; reaching this line
      // means the container-level event arrived first and the backstop is
      // still armed.
      clearWindowPointerUpFallback();
      startX.current = null;
      startY.current = null;
      if (panStarted.current) {
        try {
          containerRef.current?.releasePointerCapture(e.pointerId);
        } catch (err) {
          // releasePointerCapture throws if the pointerId wasn't captured
          // (setPointerCapture above may have failed). Symmetrical swallow.
          devWarn('[flipbook] releasePointerCapture failed at drag end; ignoring', err);
        }
        setIsPanning(false);
        panStarted.current = false;
      }
      activePointerIdRef.current = null;
    },
    [containerRef],
  );

  // Unmount cleanup. If the viewer unmounts mid-drag (Suspense fallback,
  // route change, consumer-driven remount), the window-level pointerup/cancel
  // listener installed in onPointerDown would otherwise linger past the
  // viewer's lifetime — leaking memory, firing on later unrelated pointer
  // events, and potentially calling releasePointerCapture on a detached
  // container. Reset all drag state symmetrically. Deps are intentionally []
  // — refs and clearWindowPointerUpFallback are stable identities; no
  // setIsPanning call here because React discards the state on unmount.
  useEffect(() => {
    // Capture the container element once at effect setup. React 19 nulls
    // `containerRef.current` BEFORE useEffect cleanups run (verified
    // empirically); reading `containerRef.current` inside the cleanup would
    // short-circuit and skip the release. Closure-capturing here mirrors
    // curl's pattern at `usePageCurlGesture.ts:424` where the effect body
    // does `const stage = stageRef.current;` and the cleanup uses that
    // closure-captured `stage` (not `stageRef.current`).
    const container = containerRef.current;
    return () => {
      // Release pointer capture FIRST (while activePointerIdRef still holds
      // the pointerId we captured). Gated on panStarted because capture is
      // only acquired post-threshold; pre-threshold drags never called
      // setPointerCapture. Container may already be detached at this point,
      // which is why we wrap in try/catch — release on a detached element is
      // a no-op-or-throw depending on the browser.
      if (panStarted.current && activePointerIdRef.current !== null) {
        try {
          container?.releasePointerCapture(activePointerIdRef.current);
        } catch (err) {
          devWarn('[flipbook] releasePointerCapture failed during unmount; ignoring', err);
        }
      }
      clearWindowPointerUpFallback();
      startX.current = null;
      startY.current = null;
      panStarted.current = false;
      activePointerIdRef.current = null;
    };
  }, []);

  return { setInteractionMode, isPanning, onPointerDown, onPointerMove, onPointerUp };
}
