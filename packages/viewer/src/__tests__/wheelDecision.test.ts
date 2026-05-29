import { describe, it, expect } from 'vitest';
import { decideCurlWheelDispatch, type CurlWheelDecisionInputs } from '../curl/wheelDecision';

const base: CurlWheelDecisionInputs = {
  direction: 'next',
  isAnimating: false,
  hasNextSpread: true,
  hasPreviousSpread: true,
  nextBitmapReady: true,
  prevBitmapReady: true,
  lastWheelTimestamp: -Infinity,
  now: 1000,
  cooldownMs: 150,
};

describe('decideCurlWheelDispatch', () => {
  it('fires when all gates pass', () => {
    expect(decideCurlWheelDispatch(base)).toEqual({ fire: true, newLastWheelTimestamp: 1000 });
  });

  it('does not fire when animating', () => {
    expect(decideCurlWheelDispatch({ ...base, isAnimating: true })).toEqual({ fire: false });
  });

  it('does not fire within cooldown window', () => {
    expect(decideCurlWheelDispatch({ ...base, lastWheelTimestamp: 900, now: 1000 })).toEqual({ fire: false });
  });

  it('fires past cooldown window', () => {
    expect(decideCurlWheelDispatch({ ...base, lastWheelTimestamp: 800, now: 1000 })).toEqual({ fire: true, newLastWheelTimestamp: 1000 });
  });

  it('next direction does not fire when !hasNextSpread', () => {
    expect(decideCurlWheelDispatch({ ...base, direction: 'next', hasNextSpread: false })).toEqual({ fire: false });
  });

  it('next direction does not fire when !nextBitmapReady', () => {
    expect(decideCurlWheelDispatch({ ...base, direction: 'next', nextBitmapReady: false })).toEqual({ fire: false });
  });

  it('previous direction does not fire when !hasPreviousSpread', () => {
    expect(decideCurlWheelDispatch({ ...base, direction: 'previous', hasPreviousSpread: false })).toEqual({ fire: false });
  });

  it('previous direction does not fire when !prevBitmapReady', () => {
    expect(decideCurlWheelDispatch({ ...base, direction: 'previous', prevBitmapReady: false })).toEqual({ fire: false });
  });

  it('animating gate takes precedence over cooldown', () => {
    // Both gates active → first one checked (animating) returns false.
    expect(decideCurlWheelDispatch({ ...base, isAnimating: true, lastWheelTimestamp: 900, now: 1000 })).toEqual({ fire: false });
  });

  it('first event fires within first 150ms of mount (lastWheelTimestamp=-Infinity sentinel)', () => {
    // Same sentinel pattern as the zoom side: -Infinity ensures
    // `now - (-Infinity) === Infinity` always exceeds cooldownMs.
    expect(decideCurlWheelDispatch({ ...base, lastWheelTimestamp: -Infinity, now: 50 })).toEqual({ fire: true, newLastWheelTimestamp: 50 });
  });
});
