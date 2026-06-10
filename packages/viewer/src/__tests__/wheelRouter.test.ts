import { describe, it, expect } from 'vitest';
import { routeWheelEvent, type WheelRouteInputs } from '../zoom/wheelRouter';
import { MIN_SCALE, MAX_SCALE } from '../zoom/zoomingLevel';

// Base inputs for "happy path" — modifier-less, ready, in fit-page state.
// Tests override only the field they exercise.
const base: WheelRouteInputs = {
  ctrlKey: false,
  metaKey: false,
  deltaX: 0,
  deltaY: 0,
  isReady: true,
  isOverflowing: false,
  effectiveScale: 1,
  hasCurlHandler: false,
  // Initialized to -Infinity so the throttle base case represents "no prior
  // event" — `now - (-Infinity) === Infinity` always >= throttleMs. The caller
  // (FlipbookProvider via useWheelRouter) initializes lastZoomTimestampRef to
  // -Infinity for the same reason.
  lastZoomTimestamp: -Infinity,
  now: 1000,
  throttleMs: 150,
};

describe('routeWheelEvent — loading state gate', () => {
  it('non-modifier wheel during loading returns noop (browser does nothing visible)', () => {
    expect(routeWheelEvent({ ...base, isReady: false, deltaY: 50 })).toEqual({ kind: 'noop' });
  });

  it('Ctrl+wheel during loading returns preventDefault-only (suppress browser zoom, skip dispatch)', () => {
    expect(routeWheelEvent({ ...base, isReady: false, ctrlKey: true, deltaY: -50 })).toEqual({ kind: 'preventDefault-only' });
  });

  it('Cmd+wheel during loading also returns preventDefault-only', () => {
    expect(routeWheelEvent({ ...base, isReady: false, metaKey: true, deltaY: -50 })).toEqual({ kind: 'preventDefault-only' });
  });
});

describe('routeWheelEvent — Case 1: Ctrl/Cmd + wheel zoom', () => {
  it('Ctrl + wheel up (deltaY < 0) returns zoom with increased customScale', () => {
    const route = routeWheelEvent({ ...base, ctrlKey: true, deltaY: -50, effectiveScale: 1 });
    expect(route).toEqual({ kind: 'zoom', customScale: 1.1, newLastZoomTimestamp: 1000 });
  });

  it('Ctrl + wheel down (deltaY > 0) returns zoom with decreased customScale', () => {
    const route = routeWheelEvent({ ...base, ctrlKey: true, deltaY: 50, effectiveScale: 1 });
    expect(route).toEqual({ kind: 'zoom', customScale: 0.9, newLastZoomTimestamp: 1000 });
  });

  it('Cmd + wheel works identically to Ctrl + wheel (cross-platform modifier)', () => {
    const ctrl = routeWheelEvent({ ...base, ctrlKey: true, deltaY: -50 });
    const meta = routeWheelEvent({ ...base, metaKey: true, deltaY: -50 });
    expect(meta).toEqual(ctrl);
  });

  it('zero-delta Ctrl+wheel returns preventDefault-only (no spurious zoom)', () => {
    const route = routeWheelEvent({ ...base, ctrlKey: true, deltaY: 0 });
    expect(route).toEqual({ kind: 'preventDefault-only' });
  });

  it('throttle drops events within window (now - lastZoomTimestamp < throttleMs)', () => {
    const route = routeWheelEvent({ ...base, ctrlKey: true, deltaY: -50, lastZoomTimestamp: 900, now: 1000 });
    // 1000 - 900 = 100 < 150 → drop.
    expect(route).toEqual({ kind: 'preventDefault-only' });
  });

  it('throttle allows events past window', () => {
    const route = routeWheelEvent({ ...base, ctrlKey: true, deltaY: -50, lastZoomTimestamp: 800, now: 1000 });
    // 1000 - 800 = 200 > 150 → fire.
    expect(route.kind).toBe('zoom');
  });

  it('first event fires within first 150ms of mount (lastZoomTimestamp=-Infinity sentinel)', () => {
    // Regression guard for the first-event sentinel. With `0` as initial
    // value, a user's first Ctrl+wheel at performance.now()=50ms would produce
    // `50 - 0 = 50 < 150` → swallowed. The -Infinity sentinel guarantees
    // `50 - (-Infinity) === Infinity` always exceeds throttleMs → first event
    // fires.
    const route = routeWheelEvent({
      ...base,
      ctrlKey: true,
      deltaY: -50,
      lastZoomTimestamp: -Infinity,
      now: 50,
    });
    expect(route.kind).toBe('zoom');
  });

  it('same-value short-circuit at cap (zoomIncrease(MAX_SCALE) === MAX_SCALE)', () => {
    const route = routeWheelEvent({ ...base, ctrlKey: true, deltaY: -50, effectiveScale: MAX_SCALE });
    expect(route).toEqual({ kind: 'preventDefault-only' });
  });

  it('same-value short-circuit at floor (zoomDecrease(MIN_SCALE) === MIN_SCALE)', () => {
    const route = routeWheelEvent({ ...base, ctrlKey: true, deltaY: 50, effectiveScale: MIN_SCALE });
    expect(route).toEqual({ kind: 'preventDefault-only' });
  });

  it('Chrome macOS trackpad pinch quirk: synthetic ctrlKey:true routes to zoom (same as physical Ctrl)', () => {
    // Pinch-zoom event from macOS Chrome arrives as wheel with ctrlKey:true.
    // routeWheelEvent's Case 1 covers it identically — no special handling.
    const route = routeWheelEvent({ ...base, ctrlKey: true, deltaY: -50 });
    expect(route.kind).toBe('zoom');
  });
});

describe('routeWheelEvent — Case 2: isOverflowing returns noop', () => {
  it('plain wheel + isOverflowing returns noop (browser scrolls natively)', () => {
    expect(routeWheelEvent({ ...base, isOverflowing: true, deltaY: 50 })).toEqual({ kind: 'noop' });
  });

  it('plain wheel + isOverflowing + curl handler still returns noop (overflow takes precedence)', () => {
    expect(routeWheelEvent({ ...base, isOverflowing: true, hasCurlHandler: true, deltaY: 50 })).toEqual({ kind: 'noop' });
  });
});

describe('routeWheelEvent — Case 3: curl handler routing', () => {
  it('plain wheel down + curl handler + !isOverflowing returns curl(next)', () => {
    expect(routeWheelEvent({ ...base, hasCurlHandler: true, deltaY: 50 })).toEqual({ kind: 'curl', direction: 'next' });
  });

  it('plain wheel up + curl handler + !isOverflowing returns curl(previous)', () => {
    expect(routeWheelEvent({ ...base, hasCurlHandler: true, deltaY: -50 })).toEqual({ kind: 'curl', direction: 'previous' });
  });

  it('max-magnitude axis: |deltaX| > |deltaY| → uses deltaX', () => {
    const route = routeWheelEvent({ ...base, hasCurlHandler: true, deltaX: 80, deltaY: 10 });
    expect(route).toEqual({ kind: 'curl', direction: 'next' });
  });

  it('zero dominant delta → noop (no axis to route)', () => {
    expect(routeWheelEvent({ ...base, hasCurlHandler: true, deltaX: 0, deltaY: 0 })).toEqual({ kind: 'noop' });
  });
});

describe('routeWheelEvent — Case 4: no handler, no overflow, no modifier', () => {
  it('plain wheel + no curl + !isOverflowing returns noop', () => {
    expect(routeWheelEvent({ ...base, deltaY: 50 })).toEqual({ kind: 'noop' });
  });
});
