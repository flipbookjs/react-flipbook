import { describe, it, expect } from 'vitest';
import { getSpreadAdjacency } from '../curl/getSpreadAdjacency';
import type { Spread } from '../core/computeSpreads';

const spreads: Spread[] = [
  { left: null, right: 0 },      // cover
  { left: 1, right: 2 },          // spread 1
  { left: 3, right: 4 },          // spread 2
  { left: 5, right: null },       // back cover
];

describe('getSpreadAdjacency', () => {
  it('returns "same" for identical indices', () => {
    expect(getSpreadAdjacency(1, 1, spreads)).toBe('same');
  });

  it('returns "next" for target = current + 1', () => {
    expect(getSpreadAdjacency(1, 2, spreads)).toBe('next');
  });

  it('returns "previous" for target = current - 1', () => {
    expect(getSpreadAdjacency(2, 1, spreads)).toBe('previous');
  });

  it('returns "non-adjacent" for jumps > 1', () => {
    expect(getSpreadAdjacency(0, 3, spreads)).toBe('non-adjacent');
    expect(getSpreadAdjacency(3, 0, spreads)).toBe('non-adjacent');
  });

  it('returns "non-adjacent" for out-of-range indices', () => {
    expect(getSpreadAdjacency(-1, 0, spreads)).toBe('non-adjacent');
    expect(getSpreadAdjacency(0, 99, spreads)).toBe('non-adjacent');
  });

  it('first spread + previous = non-adjacent (boundary case)', () => {
    expect(getSpreadAdjacency(0, -1, spreads)).toBe('non-adjacent');
  });

  it('last spread + next = non-adjacent (boundary case)', () => {
    expect(getSpreadAdjacency(3, 4, spreads)).toBe('non-adjacent');
  });
});
