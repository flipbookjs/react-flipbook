import { describe, it, expect } from 'vitest';
import { decideCurlNavDispatch, type CurlNavDecisionInputs } from '../curl/navDecision';

const base: CurlNavDecisionInputs = {
  direction: 'next',
  isAnimating: false,
  hasNextSpread: true,
  hasPreviousSpread: true,
  nextBitmapReady: true,
  prevBitmapReady: true,
};

describe('decideCurlNavDispatch', () => {
  it('curls when all gates pass (next)', () => {
    expect(decideCurlNavDispatch(base)).toBe('curl');
  });

  it('curls when all gates pass (previous)', () => {
    expect(decideCurlNavDispatch({ ...base, direction: 'previous' })).toBe('curl');
  });

  it('ignores while a curl is animating', () => {
    expect(decideCurlNavDispatch({ ...base, isAnimating: true })).toBe('ignore');
  });

  it('ignores at the last edge (next with no next spread)', () => {
    expect(decideCurlNavDispatch({ ...base, direction: 'next', hasNextSpread: false })).toBe('ignore');
  });

  it('ignores at the first edge (previous with no previous spread)', () => {
    expect(decideCurlNavDispatch({ ...base, direction: 'previous', hasPreviousSpread: false })).toBe('ignore');
  });

  it('snaps (not drops) when the next target bitmap is not ready', () => {
    expect(decideCurlNavDispatch({ ...base, direction: 'next', nextBitmapReady: false })).toBe('snap');
  });

  it('snaps (not drops) when the previous target bitmap is not ready', () => {
    expect(decideCurlNavDispatch({ ...base, direction: 'previous', prevBitmapReady: false })).toBe('snap');
  });

  it('busy gate takes precedence over the readiness gate', () => {
    // Animating AND bitmap-not-ready → ignore (busy checked first), NOT snap.
    expect(decideCurlNavDispatch({ ...base, isAnimating: true, nextBitmapReady: false })).toBe('ignore');
  });

  it('edge gate takes precedence over the readiness gate', () => {
    // No target AND bitmap-not-ready → ignore (edge checked first), NOT snap.
    expect(decideCurlNavDispatch({ ...base, hasNextSpread: false, nextBitmapReady: false })).toBe('ignore');
  });

  it('opposite-direction readiness does not affect the decision', () => {
    // Going next only cares about next readiness; prev bitmap being unready is irrelevant.
    expect(decideCurlNavDispatch({ ...base, direction: 'next', prevBitmapReady: false })).toBe('curl');
  });
});
