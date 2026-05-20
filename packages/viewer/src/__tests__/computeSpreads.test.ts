import { describe, it, expect } from 'vitest';
import {
  computeSpreads,
  computeSpreadCount,
  getAnchorPage,
  pageToSpreadIndex,
} from '../core/computeSpreads';

describe('computeSpreads', () => {
  describe('single mode', () => {
    it('returns [] for 0 pages', () => {
      expect(computeSpreads(0, 'single')).toEqual([]);
    });

    it('returns one spread for 1 page', () => {
      expect(computeSpreads(1, 'single')).toEqual([
        { left: null, right: 0 },
      ]);
    });

    it('returns 3 spreads for 3 pages', () => {
      expect(computeSpreads(3, 'single')).toEqual([
        { left: null, right: 0 },
        { left: null, right: 1 },
        { left: null, right: 2 },
      ]);
    });
  });

  describe('dual-cover mode', () => {
    it('returns [] for 0 pages', () => {
      expect(computeSpreads(0, 'dual-cover')).toEqual([]);
    });

    it('returns cover only for 1 page', () => {
      expect(computeSpreads(1, 'dual-cover')).toEqual([
        { left: null, right: 0 },
      ]);
    });

    it('returns cover + back cover for 2 pages', () => {
      expect(computeSpreads(2, 'dual-cover')).toEqual([
        { left: null, right: 0 },
        { left: 1, right: null },
      ]);
    });

    it('returns cover + 1 pair for 3 pages', () => {
      expect(computeSpreads(3, 'dual-cover')).toEqual([
        { left: null, right: 0 },
        { left: 1, right: 2 },
      ]);
    });

    it('returns cover + 1 pair + back cover for 4 pages', () => {
      expect(computeSpreads(4, 'dual-cover')).toEqual([
        { left: null, right: 0 },
        { left: 1, right: 2 },
        { left: 3, right: null },
      ]);
    });

    it('returns cover + 2 pairs for 5 pages', () => {
      expect(computeSpreads(5, 'dual-cover')).toEqual([
        { left: null, right: 0 },
        { left: 1, right: 2 },
        { left: 3, right: 4 },
      ]);
    });

    it('returns 6 spreads for 10 pages (even)', () => {
      const spreads = computeSpreads(10, 'dual-cover');
      expect(spreads).toEqual([
        { left: null, right: 0 },
        { left: 1, right: 2 },
        { left: 3, right: 4 },
        { left: 5, right: 6 },
        { left: 7, right: 8 },
        { left: 9, right: null },
      ]);
    });

    it('returns 6 spreads for 11 pages (odd)', () => {
      const spreads = computeSpreads(11, 'dual-cover');
      expect(spreads).toEqual([
        { left: null, right: 0 },
        { left: 1, right: 2 },
        { left: 3, right: 4 },
        { left: 5, right: 6 },
        { left: 7, right: 8 },
        { left: 9, right: 10 },
      ]);
    });
  });
});

describe('computeSpreadCount', () => {
  it('matches computeSpreads.length for pageCount 0..50 in both modes', () => {
    for (let n = 0; n <= 50; n++) {
      for (const mode of ['single', 'dual-cover'] as const) {
        expect(computeSpreadCount(n, mode)).toBe(computeSpreads(n, mode).length);
      }
    }
  });
});

describe('getAnchorPage', () => {
  it('returns left for both slots filled (LTR)', () => {
    expect(getAnchorPage({ left: 3, right: 4 })).toBe(3);
  });

  it('returns right when left is null (cover)', () => {
    expect(getAnchorPage({ left: null, right: 0 })).toBe(0);
  });

  it('returns left when right is null (back cover)', () => {
    expect(getAnchorPage({ left: 5, right: null })).toBe(5);
  });
});

describe('pageToSpreadIndex', () => {
  const spreads = computeSpreads(10, 'dual-cover');

  it('finds page 0 at spread index 0', () => {
    expect(pageToSpreadIndex(0, spreads)).toBe(0);
  });

  it('finds page 5 at spread index 3', () => {
    expect(pageToSpreadIndex(5, spreads)).toBe(3);
  });

  it('returns 0 for out-of-range page', () => {
    expect(pageToSpreadIndex(99, spreads)).toBe(0);
  });

  it('returns 0 for empty spreads', () => {
    expect(pageToSpreadIndex(0, [])).toBe(0);
  });
});
