import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useRef, type Dispatch } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { useSelectionMode } from '../hooks/useSelectionMode';
import type { FlipbookAction } from '../core/flipbookReducer';

// Module-scoped: save originals once so afterEach can restore. JSDOM 29 does
// NOT ship setPointerCapture/releasePointerCapture on HTMLElement.prototype —
// the assignment in beforeEach is mandatory for any test that exercises the
// threshold-cross path. Pattern mirrors usePageCurlGesture.test.tsx:48-69.
const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
const originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;

let setPointerCaptureSpy: ReturnType<typeof vi.fn<(pointerId: number) => void>>;
let releasePointerCaptureSpy: ReturnType<typeof vi.fn<(pointerId: number) => void>>;

beforeEach(() => {
  setPointerCaptureSpy = vi.fn<(pointerId: number) => void>();
  releasePointerCaptureSpy = vi.fn<(pointerId: number) => void>();
  HTMLElement.prototype.setPointerCapture = setPointerCaptureSpy;
  HTMLElement.prototype.releasePointerCapture = releasePointerCaptureSpy;
});

afterEach(() => {
  HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
  HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
  vi.restoreAllMocks();
});

interface HarnessProps {
  interactionMode: 'select' | 'pan';
  isOverflowing: boolean;
  dispatch: Dispatch<FlipbookAction>;
  onHookReturn?: (ret: ReturnType<typeof useSelectionMode>) => void;
}

function Harness({ interactionMode, isOverflowing, dispatch, onHookReturn }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hookReturn = useSelectionMode({
    containerRef,
    isOverflowing,
    interactionMode,
    dispatch,
  });
  onHookReturn?.(hookReturn);
  return (
    <div
      ref={containerRef}
      data-testid="container"
      data-is-panning={hookReturn.isPanning ? 'true' : undefined}
      onPointerDown={hookReturn.onPointerDown}
      onPointerMove={hookReturn.onPointerMove}
      onPointerUp={hookReturn.onPointerUp}
      onPointerCancel={hookReturn.onPointerUp}
      style={{ width: 100, height: 100 }}
    />
  );
}

describe('useSelectionMode', () => {
  it('1. setInteractionMode dispatches SET_INTERACTION_MODE', () => {
    const dispatch = vi.fn();
    let hookRet: ReturnType<typeof useSelectionMode> | null = null;
    render(
      <Harness
        interactionMode="select"
        isOverflowing={true}
        dispatch={dispatch}
        onHookReturn={(r) => { hookRet = r; }}
      />,
    );
    act(() => {
      hookRet!.setInteractionMode('pan');
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_INTERACTION_MODE', value: 'pan' });
  });

  it('2. Below-threshold pointermove does NOT scroll the container', () => {
    const dispatch = vi.fn();
    const { getByTestId } = render(
      <Harness interactionMode="pan" isOverflowing={true} dispatch={dispatch} />,
    );
    const container = getByTestId('container') as HTMLDivElement;
    container.scrollLeft = 0;
    container.scrollTop = 0;

    fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 52, clientY: 53 });

    expect(container.scrollLeft).toBe(0);
    expect(container.scrollTop).toBe(0);
    expect(setPointerCaptureSpy).not.toHaveBeenCalled();
    expect(container.getAttribute('data-is-panning')).toBeNull();
  });

  it('3. Above-threshold pointermove scrolls by delta + sets isPanning true', () => {
    const dispatch = vi.fn();
    const { getByTestId } = render(
      <Harness interactionMode="pan" isOverflowing={true} dispatch={dispatch} />,
    );
    const container = getByTestId('container') as HTMLDivElement;
    container.scrollLeft = 100;
    container.scrollTop = 100;

    fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 60, clientY: 55 });

    // dx = 10, dy = 5; |dx|=10 ≥ 4 → threshold crossed. scrollLeft = 100 - 10 = 90.
    expect(container.scrollLeft).toBe(90);
    expect(container.scrollTop).toBe(95);
    expect(setPointerCaptureSpy).toHaveBeenCalledTimes(1);
    expect(setPointerCaptureSpy).toHaveBeenCalledWith(1);
    expect(container.getAttribute('data-is-panning')).toBe('true');
  });

  it('4. PointerUp releases capture and clears isPanning', () => {
    const dispatch = vi.fn();
    const { getByTestId } = render(
      <Harness interactionMode="pan" isOverflowing={true} dispatch={dispatch} />,
    );
    const container = getByTestId('container') as HTMLDivElement;

    fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 60, clientY: 50 });
    expect(container.getAttribute('data-is-panning')).toBe('true');

    fireEvent.pointerUp(container, { pointerId: 1, clientX: 60, clientY: 50 });
    expect(releasePointerCaptureSpy).toHaveBeenCalledWith(1);
    expect(container.getAttribute('data-is-panning')).toBeNull();
  });

  it('5. When isOverflowing=false, pointermove is a no-op', () => {
    const dispatch = vi.fn();
    const { getByTestId } = render(
      <Harness interactionMode="pan" isOverflowing={false} dispatch={dispatch} />,
    );
    const container = getByTestId('container') as HTMLDivElement;
    container.scrollLeft = 50;
    container.scrollTop = 50;

    fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 80, clientY: 80 });

    expect(container.scrollLeft).toBe(50);
    expect(container.scrollTop).toBe(50);
    expect(setPointerCaptureSpy).not.toHaveBeenCalled();
    expect(container.getAttribute('data-is-panning')).toBeNull();
  });

  it('6. Outside-release backstop — pre-threshold path clears activePointerIdRef', () => {
    const dispatch = vi.fn();
    const { getByTestId } = render(
      <Harness interactionMode="pan" isOverflowing={true} dispatch={dispatch} />,
    );
    const container = getByTestId('container') as HTMLDivElement;
    container.scrollLeft = 0;

    // First pointerdown with pointerId 1; NO threshold-crossing move; NO container pointerup.
    fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });

    // Window-level pointerup fires outside the container (backstop catches it).
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    });

    // Second pointerdown with a DIFFERENT pointerId 2 (deliberately distinct: a
    // same-id pointerdown would pass the activePointerIdRef !== null guard
    // trivially after the first set the ref to 1; the !== null clearing is what
    // we want to exercise).
    fireEvent.pointerDown(container, { pointerId: 2, button: 0, clientX: 100, clientY: 100 });

    // If the backstop cleared activePointerIdRef, the second pointerdown is
    // accepted and a subsequent threshold-crossing pointermove will scroll.
    fireEvent.pointerMove(container, { pointerId: 2, clientX: 110, clientY: 100 });

    expect(container.scrollLeft).toBe(-10);
    expect(setPointerCaptureSpy).toHaveBeenCalledWith(2);
  });

  it('7. Outside-release backstop — capture-failure path resets state', () => {
    setPointerCaptureSpy.mockImplementation(() => {
      throw new Error('InvalidStateError');
    });
    const dispatch = vi.fn();
    const { getByTestId } = render(
      <Harness interactionMode="pan" isOverflowing={true} dispatch={dispatch} />,
    );
    const container = getByTestId('container') as HTMLDivElement;

    fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    // Threshold-crossing move: setPointerCapture throws but pan continues per
    // hook's swallow-and-continue contract.
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 60, clientY: 50 });
    expect(setPointerCaptureSpy).toHaveBeenCalledWith(1);
    expect(container.getAttribute('data-is-panning')).toBe('true');

    // No container pointerup. Window pointerup fires (the backstop's path).
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    });

    // Backstop's release-capture branch ran (panStarted was true), then reset
    // all state. isPanning must be false now; a subsequent pointerdown with a
    // fresh pointerId must be accepted (proving activePointerIdRef was cleared).
    expect(container.getAttribute('data-is-panning')).toBeNull();
    expect(releasePointerCaptureSpy).toHaveBeenCalledWith(1);

    fireEvent.pointerDown(container, { pointerId: 2, button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerMove(container, { pointerId: 2, clientX: 40, clientY: 30 });
    // setPointerCapture still throws (the mock persists), but the threshold
    // logic + scroll write should still execute, proving the second drag
    // started cleanly.
    expect(setPointerCaptureSpy).toHaveBeenCalledTimes(2);
  });

  it('8. Unmount cleanup releases pointer capture AND removes window backstop', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const dispatch = vi.fn();
    const { getByTestId, unmount } = render(
      <Harness interactionMode="pan" isOverflowing={true} dispatch={dispatch} />,
    );
    const container = getByTestId('container') as HTMLDivElement;

    fireEvent.pointerDown(container, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 60, clientY: 50 });
    expect(container.getAttribute('data-is-panning')).toBe('true');
    expect(setPointerCaptureSpy).toHaveBeenCalledWith(1);

    // Capture the fallback function reference that was installed.
    const pointerupAddCall = addEventListenerSpy.mock.calls.find((c) => c[0] === 'pointerup');
    const pointercancelAddCall = addEventListenerSpy.mock.calls.find((c) => c[0] === 'pointercancel');
    expect(pointerupAddCall).toBeDefined();
    expect(pointercancelAddCall).toBeDefined();
    const fallbackFn = pointerupAddCall![1];
    // Both add() calls install the SAME fallback fn (single closure).
    expect(pointercancelAddCall![1]).toBe(fallbackFn);

    unmount();

    // The unmount cleanup useEffect ran. Assertions:
    // (a) releasePointerCapture was called with the captured pointerId.
    expect(releasePointerCaptureSpy).toHaveBeenCalledWith(1);
    // (b) window.removeEventListener was called for both events with the SAME
    //     installed fallback fn.
    expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerup', fallbackFn);
    expect(removeEventListenerSpy).toHaveBeenCalledWith('pointercancel', fallbackFn);
    // (c) releasePointerCapture was called BEFORE the removeEventListener calls
    //     (the hook's cleanup order: release → clearWindowPointerUpFallback).
    const releaseOrder = releasePointerCaptureSpy.mock.invocationCallOrder[0];
    const removeOrders = removeEventListenerSpy.mock.calls
      .map((_, i) => removeEventListenerSpy.mock.invocationCallOrder[i]);
    // Find the FIRST remove call related to our fallback fn.
    const firstFallbackRemoveOrder = Math.min(
      ...removeEventListenerSpy.mock.calls
        .map((c, i) => (c[1] === fallbackFn ? removeOrders[i] : Infinity)),
    );
    expect(releaseOrder).toBeLessThan(firstFallbackRemoveOrder);
  });
});
