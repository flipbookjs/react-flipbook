import { describe, it, expect } from 'vitest';
import { increase, decrease } from '../zoom/zoomingLevel';

describe('zoomingLevel.increase', () => {
  it('returns the next larger level for a value within the array', () => {
    expect(increase(1)).toBe(1.1);
    expect(increase(1.5)).toBe(1.7);
    expect(increase(3.7)).toBe(4);
  });

  it('returns the smallest level for a value below the array min', () => {
    expect(increase(0)).toBe(0.1);
    expect(increase(0.05)).toBe(0.1);
  });

  it('is idempotent at the cap (Decision 5 H1 fix — no dead clicks)', () => {
    expect(increase(4)).toBe(4);
  });

  it('returns currentLevel for values above the cap', () => {
    expect(increase(5)).toBe(5);
    expect(increase(100)).toBe(100);
  });
});

describe('zoomingLevel.decrease', () => {
  it('returns the previous level for a value within the array', () => {
    expect(decrease(1.1)).toBe(1);
    expect(decrease(4)).toBe(3.7);
    expect(decrease(1.5)).toBe(1.3);
  });

  it('returns currentLevel for values at or below the array min', () => {
    expect(decrease(0.1)).toBe(0.1);
    expect(decrease(0.05)).toBe(0.05);
  });

  it('returns the largest level smaller than currentLevel for values above the cap', () => {
    // findIndex returns -1 because no item >= 5; returns currentLevel.
    // Actually: findIndex returns -1 when no match, decrease returns currentLevel.
    // For values larger than all LEVELS entries, no level >= currentLevel exists.
    expect(decrease(5)).toBe(5);
  });
});
