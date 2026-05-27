// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageCurlGesture, type UsePageCurlGestureParams } from '../curl/usePageCurlGesture';
import type { CurlAnimationActions } from '../curl/useCurlAnimation';

// Stub actions — referentially stable per HG2.
function makeStubActions(): CurlAnimationActions {
  return {
    startDrag: vi.fn(),
    updateDrag: vi.fn(),
    endDrag: vi.fn(),
    startAnimatedCurl: vi.fn(),
    startHover: vi.fn(),
    endHover: vi.fn(),
    cancel: vi.fn(),
    setRenderCallback: vi.fn(),
    isAnimating: vi.fn(() => false),
  };
}

function makeRect(width = 1200, height = 800): DOMRect {
  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON() {
      return { x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0 };
    },
  } as DOMRect;
}

function makeStage(): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'fbjs-stage';
  Object.defineProperty(div, 'getBoundingClientRect', {
    value: () => makeRect(),
  });
  document.body.appendChild(div);
  return div;
}

let stage: HTMLDivElement;
let overlay: HTMLCanvasElement;
let actions: CurlAnimationActions;
let setPointerCaptureSpy: ReturnType<typeof vi.fn<(pointerId: number) => void>>;

// Save prototype originals so afterEach can restore — prevent cross-test pollution.
const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
const originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;

beforeEach(() => {
  document.body.innerHTML = '';
  stage = makeStage();
  overlay = document.createElement('canvas');
  actions = makeStubActions();
  setPointerCaptureSpy = vi.fn<(pointerId: number) => void>();
  HTMLElement.prototype.setPointerCapture = setPointerCaptureSpy;
  HTMLElement.prototype.releasePointerCapture = vi.fn<(pointerId: number) => void>();
});

afterEach(() => {
  HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
  HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
});

function makeParams(overrides: Partial<UsePageCurlGestureParams> = {}): UsePageCurlGestureParams {
  return {
    enabled: true,
    stageRef: { current: stage },
    overlayRef: { current: overlay },
    overlayRect: makeRect(),
    pageWidth: 600,
    pageHeight: 800,
    actions,
    useDualCoordinates: true,
    hasNextSpread: true,
    hasPreviousSpread: true,
    nextBitmapReady: true,
    prevBitmapReady: true,
    ...overrides,
  };
}

function dispatchPointerEvent(target: EventTarget, type: string, clientX: number, clientY: number): void {
  const event = new PointerEvent(type, {
    clientX,
    clientY,
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
  });
  target.dispatchEvent(event);
}

describe('usePageCurlGesture — corner hit-test + setPointerCapture', () => {
  it('bottom-right corner pointerdown triggers next-curl', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    // bottom-right corner of stage (1200, 800) — within 80px radius
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.startDrag).toHaveBeenCalledWith('next');
    // Initial render: gesture handler dispatches updateDrag immediately after startDrag.
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
  });

  it('bottom-left corner pointerdown triggers previous-curl', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 30, 770);
    expect(actions.startDrag).toHaveBeenCalledWith('previous');
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);
  });

  it('tap on bottom-right corner (pointerdown+pointerup at same position) triggers animated next-curl', () => {
    // Tap detection: pointerup within TAP_MOVE_THRESHOLD_PX (5) of pointerdown
    // routes through cancel() + startAnimatedCurl instead of endDrag (which
    // would spring back because progress < commitThreshold on a zero-distance
    // drag). Architectural plan Checklist item 13: "Click bottom-right corner
    // → curl forward."
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    dispatchPointerEvent(stage, 'pointerup', 1150, 750); // identical position → tap
    expect(actions.cancel).toHaveBeenCalledTimes(1);
    expect(actions.startAnimatedCurl).toHaveBeenCalledWith('next');
    expect(actions.endDrag).not.toHaveBeenCalled(); // tap path bypasses endDrag
  });

  it('tap on bottom-left corner triggers animated previous-curl', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 30, 770);
    dispatchPointerEvent(stage, 'pointerup', 32, 772); // 2.8 px movement, under 5 px threshold
    expect(actions.startAnimatedCurl).toHaveBeenCalledWith('previous');
    expect(actions.endDrag).not.toHaveBeenCalled();
  });

  it('drag (movement past TAP_MOVE_THRESHOLD_PX) calls endDrag, not the tap path', () => {
    // Boundary check: ensure movement ≥ 5px reverts to the normal endDrag path.
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    dispatchPointerEvent(stage, 'pointerup', 1100, 700); // ~71 px movement, well past threshold
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
    expect(actions.startAnimatedCurl).not.toHaveBeenCalled();
  });

  it('TOP-right corner pointerdown does NOT trigger curl (cornerToDirection returns null for top corners)', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 1180, 20); // top-right area
    expect(actions.startDrag).not.toHaveBeenCalled();
  });

  it('TOP-left corner pointerdown does NOT trigger curl', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 20, 30);
    expect(actions.startDrag).not.toHaveBeenCalled();
  });

  it('pointerdown outside any corner zone does not trigger curl', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 600, 400); // dead center
    expect(actions.startDrag).not.toHaveBeenCalled();
  });

  it('setPointerCapture called on successful corner-hit pointerdown', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(setPointerCaptureSpy).toHaveBeenCalledWith(1);
  });

  it('setPointerCapture throw is swallowed; gesture continues (graceful degradation per P2)', () => {
    setPointerCaptureSpy.mockImplementation(() => { throw new DOMException('InvalidPointerId', 'InvalidStateError'); });
    renderHook(() => usePageCurlGesture(makeParams()));
    expect(() => dispatchPointerEvent(stage, 'pointerdown', 1150, 750)).not.toThrow();
    expect(actions.startDrag).toHaveBeenCalled(); // gesture proceeded
  });

  it('I1 fallback: window-level pointerup clears refs after capture-less drag escapes the stage', () => {
    // When setPointerCapture fails, the gesture proceeds without capture. If the
    // user releases outside the stage, the stage's pointerup never fires —
    // window-level fallback must clear activePointerIdRef so future gestures aren't blocked.
    setPointerCaptureSpy.mockImplementation(() => { throw new DOMException('InvalidPointerId', 'InvalidStateError'); });
    renderHook(() => usePageCurlGesture(makeParams()));

    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.startDrag).toHaveBeenCalledTimes(1);

    // Simulate user releasing OUTSIDE the stage (pointerup fires on window only).
    const winUp = new PointerEvent('pointerup', { pointerId: 1, bubbles: true });
    window.dispatchEvent(winUp);

    expect(actions.cancel).toHaveBeenCalledTimes(1);

    // Verify refs cleared: a SECOND pointerdown must be accepted (not blocked by the multi-touch guard).
    (actions.startDrag as ReturnType<typeof vi.fn>).mockClear();
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.startDrag).toHaveBeenCalledTimes(1); // refs were cleared, gesture accepted
  });

  it('I1 fallback is removed when normal pointerup fires on the stage (no double-cancel)', () => {
    setPointerCaptureSpy.mockImplementation(() => { throw new DOMException('x', 'InvalidStateError'); });
    renderHook(() => usePageCurlGesture(makeParams()));

    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    // Pointerup at a DIFFERENT position so tap detection (TAP_MOVE_THRESHOLD_PX
    // = 5) is not triggered — this test exercises the drag-and-release endDrag
    // path. Distance from (1150, 750) → (1050, 700) is ~112 px, well past tap.
    dispatchPointerEvent(stage, 'pointerup', 1050, 700);

    expect(actions.endDrag).toHaveBeenCalledTimes(1); // normal path

    // A LATER window pointerup (e.g., for a totally different pointer) must not re-fire cancel.
    const lateWinUp = new PointerEvent('pointerup', { pointerId: 99, bubbles: true });
    window.dispatchEvent(lateWinUp);

    expect(actions.cancel).not.toHaveBeenCalled(); // window listener was removed by handlePointerUp
  });

  it('Decision 11 precondition #2: hasNextSpread=false short-circuits forward curl', () => {
    renderHook(() => usePageCurlGesture(makeParams({ hasNextSpread: false })));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.startDrag).not.toHaveBeenCalled();
  });

  it('Decision 11 precondition #3: nextBitmapReady=false short-circuits forward curl', () => {
    renderHook(() => usePageCurlGesture(makeParams({ nextBitmapReady: false })));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.startDrag).not.toHaveBeenCalled();
  });
});

describe('usePageCurlGesture — wheel handling (per SD2)', () => {
  it('wheel with positive deltaY triggers next curl', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, deltaX: 0, bubbles: true }));
    expect(actions.startAnimatedCurl).toHaveBeenCalledWith('next');
  });

  it('wheel with negative deltaY triggers previous curl', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, deltaX: 0, bubbles: true }));
    expect(actions.startAnimatedCurl).toHaveBeenCalledWith('previous');
  });

  it('wheel uses max-magnitude axis (deltaX > deltaY → uses deltaX)', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    // Larger |deltaX| (trackpad horizontal swipe)
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, deltaX: 80, bubbles: true }));
    expect(actions.startAnimatedCurl).toHaveBeenCalledWith('next');
  });

  it('wheel cooldown (150ms) prevents rapid re-trigger', () => {
    vi.useFakeTimers();
    renderHook(() => usePageCurlGesture(makeParams()));

    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true }));
    expect(actions.startAnimatedCurl).toHaveBeenCalledTimes(1);

    // 50ms later (within cooldown)
    vi.advanceTimersByTime(50);
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true }));
    expect(actions.startAnimatedCurl).toHaveBeenCalledTimes(1); // still 1 — ignored

    // 200ms later (past cooldown)
    vi.advanceTimersByTime(200);
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true }));
    expect(actions.startAnimatedCurl).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('wheel always calls preventDefault — even during busy/cooldown', () => {
    // Old fork prevented default unconditionally at the top of handleWheel.
    // Prevents the page from scrolling underneath during animations.
    (actions.isAnimating as ReturnType<typeof vi.fn>).mockReturnValue(true);
    renderHook(() => usePageCurlGesture(makeParams()));
    const wheel = new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
    stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(actions.startAnimatedCurl).not.toHaveBeenCalled(); // busy gate held
  });
});

describe('usePageCurlGesture — pointerdown side effects', () => {
  it('preventDefault + stopPropagation fire on a curl-eligible pointerdown', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    const event = new PointerEvent('pointerdown', {
      clientX: 1150, clientY: 750, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true,
    });
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    stage.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('preventDefault is NOT called when corner-hit fails (non-curl gesture preserved)', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    const event = new PointerEvent('pointerdown', {
      clientX: 600, clientY: 400, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true,
    });
    stage.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('usePageCurlGesture — hover lifecycle', () => {
  it('pointerleave clears an active hover via actions.endHover()', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    // Hover over bottom-right corner — sets isHoveringCornerRef.current = true.
    dispatchPointerEvent(stage, 'pointermove', 1150, 750);
    expect(actions.startHover).toHaveBeenCalledWith('next');

    // Pointer exits the stage without further pointermove.
    stage.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

    expect(actions.endHover).toHaveBeenCalledTimes(1);
  });

  it('pointerleave during an active drag does NOT end hover (drag continues)', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750); // activePointerIdRef set
    stage.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(actions.endHover).not.toHaveBeenCalled();
  });
});

describe('usePageCurlGesture — pointer move / up / cancel', () => {
  it('pointermove during drag dispatches updateDrag with page-local point', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    // Start the drag — sets activePointerIdRef.current = pointerId (1)
    // and sends the initial updateDrag at pointerdown coords.
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);

    dispatchPointerEvent(stage, 'pointermove', 400, 600);

    expect(actions.updateDrag).toHaveBeenCalledTimes(2);
    const arg = (actions.updateDrag as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(typeof arg.x).toBe('number');
    expect(typeof arg.y).toBe('number');
  });

  it('pointermove from an UNCAPTURED pointer is ignored', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    // No pointerdown — activePointerIdRef stays null.
    dispatchPointerEvent(stage, 'pointermove', 400, 600);
    expect(actions.updateDrag).not.toHaveBeenCalled();
  });

  it('a second pointerdown during an active drag is ignored (multi-touch guard)', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    // First pointer claims the drag.
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.startDrag).toHaveBeenCalledTimes(1);

    // Second pointer (different pointerId) — handler must short-circuit.
    const secondEvent = new PointerEvent('pointerdown', {
      clientX: 30, clientY: 770, pointerId: 2, pointerType: 'touch', bubbles: true,
    });
    stage.dispatchEvent(secondEvent);

    expect(actions.startDrag).toHaveBeenCalledTimes(1); // still 1 — second pointerdown ignored
  });

  it('pointerdown is ignored while curl is animating (busy-state guard)', () => {
    // Mid-animation (after pointerup, auto-animate phase): activePointerIdRef is
    // null but actions.isAnimating() === true. Handler must NOT start a new drag.
    (actions.isAnimating as ReturnType<typeof vi.fn>).mockReturnValue(true);
    renderHook(() => usePageCurlGesture(makeParams()));

    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);

    expect(actions.startDrag).not.toHaveBeenCalled();
    // Subsequent pointermove must also be ignored — ref was never set.
    dispatchPointerEvent(stage, 'pointermove', 400, 600);
    expect(actions.updateDrag).not.toHaveBeenCalled();
  });

  it('pointerup dispatches endDrag with no args, after a final updateDrag with the pointerup point', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    // Start a drag — also fires initial updateDrag at pointerdown coords.
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.startDrag).toHaveBeenCalled();
    expect(actions.updateDrag).toHaveBeenCalledTimes(1);

    dispatchPointerEvent(stage, 'pointerup', 300, 500);

    // 4.C handlePointerUp sends one final updateDrag(pageLocal) THEN endDrag() with no args.
    expect(actions.updateDrag).toHaveBeenCalledTimes(2);
    expect(actions.endDrag).toHaveBeenCalledTimes(1);
    expect(actions.endDrag).toHaveBeenCalledWith(); // no-args contract
    const finalUpdate = (actions.updateDrag as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(typeof finalUpdate.x).toBe('number');
    expect(typeof finalUpdate.y).toBe('number');
  });

  it('toPageLocal: dual-mode NEXT subtracts pageWidth from x', () => {
    // bottom-right corner of right page in dual mode at clientX=1150.
    // Overlay rect spans full stage (left=0). pageWidth=600. Expected pageLocalX = 1150 - 600 = 550.
    renderHook(() => usePageCurlGesture(makeParams({ useDualCoordinates: true, pageWidth: 600 })));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    // Coords arrive via the initial updateDrag immediately after startDrag.
    expect(actions.startDrag).toHaveBeenCalledWith('next');
    const initialPoint = (actions.updateDrag as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(initialPoint.x).toBeCloseTo(550, 0);
    expect(initialPoint.y).toBeCloseTo(750, 0);
  });

  it('toPageLocal: single-mode NEXT passes overlay-x through unchanged', () => {
    renderHook(() => usePageCurlGesture(makeParams({
      useDualCoordinates: false,
      pageWidth: 600,
      overlayRect: makeRect(600),
    })));
    // Single mode: bottom-right corner is at the right edge of the page (~570).
    dispatchPointerEvent(stage, 'pointerdown', 570, 770);
    const initialPoint = (actions.updateDrag as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(initialPoint.x).toBeCloseTo(570, 0);
    expect(initialPoint.y).toBeCloseTo(770, 0);
  });

  it('toPageLocal: dual-mode PREVIOUS mirrors x around pageWidth', () => {
    // Dual-mode rect is the default 1200x800 (two 600-wide pages).
    // Bottom-LEFT corner at clientX=30, clientY=770 — distance from (0, 800)
    // is sqrt(30² + 30²) ≈ 42, within the 80px CORNER_ZONE_RADIUS.
    // toPageLocal in dual-previous mirrors: pageLocalX = pageWidth - overlayX = 600 - 30 = 570.
    renderHook(() => usePageCurlGesture(makeParams({ useDualCoordinates: true, pageWidth: 600 })));
    dispatchPointerEvent(stage, 'pointerdown', 30, 770);
    expect(actions.startDrag).toHaveBeenCalledWith('previous');
    const initialPoint = (actions.updateDrag as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(initialPoint.x).toBeCloseTo(570, 0);
    expect(initialPoint.y).toBeCloseTo(770, 0);
  });

  it('toPageLocal: single-mode PREVIOUS mirrors x around pageWidth', () => {
    // Coupling assumption: cornerToDirection('bottom-left') must return 'previous'
    // uniformly across single- AND dual-mode (the v0.1 architectural-plan convention
    // for bottom-only curls). If cornerToDirection ever becomes mode-dependent,
    // this test would silently change behavior — add an explicit assertion below.
    renderHook(() => usePageCurlGesture(makeParams({
      useDualCoordinates: false,
      pageWidth: 600,
      overlayRect: makeRect(600),
    })));
    dispatchPointerEvent(stage, 'pointerdown', 30, 770);
    expect(actions.startDrag).toHaveBeenCalledWith('previous'); // pins the coupling assumption
    const initialPoint = (actions.updateDrag as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(initialPoint.x).toBeCloseTo(570, 0); // 600 - 30
    expect(initialPoint.y).toBeCloseTo(770, 0);
  });

  it('pointercancel aborts via actions.cancel (does not commit)', () => {
    renderHook(() => usePageCurlGesture(makeParams()));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);

    dispatchPointerEvent(stage, 'pointercancel', 1150, 750);

    expect(actions.cancel).toHaveBeenCalled();
    expect(actions.endDrag).not.toHaveBeenCalled();
  });
});

describe('usePageCurlGesture — enabled: false', () => {
  it('no listeners attached when enabled is false', () => {
    renderHook(() => usePageCurlGesture(makeParams({ enabled: false })));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750); // bottom-right corner
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true }));
    expect(actions.startDrag).not.toHaveBeenCalled();
    expect(actions.startAnimatedCurl).not.toHaveBeenCalled();
  });

  it('toggling enabled false→true at runtime attaches listeners', () => {
    const { rerender } = renderHook(
      (p: UsePageCurlGestureParams) => usePageCurlGesture(p),
      { initialProps: makeParams({ enabled: false }) },
    );
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.startDrag).not.toHaveBeenCalled();

    rerender(makeParams({ enabled: true }));
    dispatchPointerEvent(stage, 'pointerdown', 1150, 750);
    expect(actions.startDrag).toHaveBeenCalledWith('next');
  });
});
