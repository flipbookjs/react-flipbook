// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Dispatch } from 'react';
import { useWheelRouter } from '../zoom/useWheelRouter';
import type { FlipbookAction } from '../core/flipbookReducer';

function setupHookHarness(overrides: {
  isReady?: boolean;
  isOverflowing?: boolean;
  effectiveScale?: number;
  curlHandler?: ((d: 'next' | 'previous') => void) | null;
  lastZoomTimestamp?: number;
} = {}) {
  // Detached container: addEventListener works on detached DOM, dispatchEvent
  // fires listeners regardless of tree placement, and renderHook mounts the
  // hook in its own internal container separate from this wheel-event target.
  // No document.body.appendChild needed → no DOM-leak risk across tests.
  const container = document.createElement('div');
  const isReadyRef = { current: overrides.isReady ?? true };
  const isOverflowingRef = { current: overrides.isOverflowing ?? false };
  const effectiveScaleRef = { current: overrides.effectiveScale ?? 1 };
  const curlWheelHandlerRef = { current: overrides.curlHandler ?? null };
  // Default to -Infinity sentinel so the first dispatched wheel always fires —
  // matches FlipbookProvider's lastZoomTimestampRef initialization.
  const lastZoomTimestampRef = { current: overrides.lastZoomTimestamp ?? -Infinity };
  const dispatch = vi.fn() as Dispatch<FlipbookAction>;
  const containerRef = { current: container };

  const { unmount } = renderHook(() =>
    useWheelRouter({
      containerRef,
      isReadyRef,
      isOverflowingRef,
      effectiveScaleRef,
      curlWheelHandlerRef,
      lastZoomTimestampRef,
      dispatch,
    }),
  );

  return {
    container,
    dispatch,
    lastZoomTimestampRef,
    curlWheelHandlerRef,
    isReadyRef,
    isOverflowingRef,
    effectiveScaleRef,
    unmount,
    dispatchWheel: (init: WheelEventInit) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
      act(() => { container.dispatchEvent(event); });
      return event;
    },
    // cleanup is just unmount — no DOM cleanup needed (detached container).
    cleanup: () => unmount(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWheelRouter', () => {
  it('attaches a wheel listener on mount (Ctrl+wheel dispatches SET_ZOOM)', () => {
    const h = setupHookHarness({ effectiveScale: 1 });
    const event = h.dispatchWheel({ ctrlKey: true, deltaY: -50 });
    expect(event.defaultPrevented).toBe(true);
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'SET_ZOOM', mode: 'custom', customScale: 1.1 });
    h.cleanup();
  });

  it('removes the listener on unmount (no dispatch after unmount)', () => {
    const h = setupHookHarness();
    h.unmount(); // detaches listener via useEffect cleanup
    h.dispatchWheel({ ctrlKey: true, deltaY: -50 });
    expect(h.dispatch).not.toHaveBeenCalled();
    // No additional cleanup needed — container is detached from the start.
  });

  it('Case curl: plain wheel + curl handler invokes the callback', () => {
    const curlHandler = vi.fn();
    const h = setupHookHarness({ curlHandler });
    const event = h.dispatchWheel({ deltaY: 50 });
    expect(event.defaultPrevented).toBe(true);
    expect(curlHandler).toHaveBeenCalledWith('next');
    expect(h.dispatch).not.toHaveBeenCalled();
    h.cleanup();
  });

  it('Case noop: plain wheel + isOverflowing does NOT preventDefault', () => {
    const h = setupHookHarness({ isOverflowing: true });
    const event = h.dispatchWheel({ deltaY: 50 });
    expect(event.defaultPrevented).toBe(false);
    expect(h.dispatch).not.toHaveBeenCalled();
    h.cleanup();
  });

  it('Case noop: plain wheel + no curl handler + !isOverflowing does NOT preventDefault', () => {
    const h = setupHookHarness({ curlHandler: null });
    const event = h.dispatchWheel({ deltaY: 50 });
    expect(event.defaultPrevented).toBe(false);
    expect(h.dispatch).not.toHaveBeenCalled();
    h.cleanup();
  });

  it('loading state: Ctrl+wheel preventDefaults but does NOT dispatch', () => {
    const h = setupHookHarness({ isReady: false });
    const event = h.dispatchWheel({ ctrlKey: true, deltaY: -50 });
    expect(event.defaultPrevented).toBe(true);
    expect(h.dispatch).not.toHaveBeenCalled();
    h.cleanup();
  });

  it('zoom case writes back to lastZoomTimestampRef', () => {
    // Explicit -Infinity here to make the "wrote back a real timestamp"
    // assertion unambiguous (-Infinity → finite positive number is a clear
    // transition vs. 0 → positive which could conflate with the initialization
    // value).
    const h = setupHookHarness({ lastZoomTimestamp: -Infinity });
    h.dispatchWheel({ ctrlKey: true, deltaY: -50 });
    expect(h.lastZoomTimestampRef.current).toBeGreaterThan(0);
    expect(Number.isFinite(h.lastZoomTimestampRef.current)).toBe(true);
    h.cleanup();
  });

  it('curl case does NOT write to lastZoomTimestampRef (timestamp is zoom-side only)', () => {
    const h = setupHookHarness({ curlHandler: vi.fn(), lastZoomTimestamp: -Infinity });
    h.dispatchWheel({ deltaY: 50 });
    expect(h.lastZoomTimestampRef.current).toBe(-Infinity);
    h.cleanup();
  });
});
