import { describe, expect, it } from 'vitest';
// Import via the re-export path to verify the chain (useFlipbook.ts re-exports
// shallowEqual from './shallowEqual'). A future refactor that drops the
// re-export would silently pass a direct-import test; this one catches it.
import { shallowEqual } from '../hooks/useFlipbook';

describe('shallowEqual', () => {
  it('returns true for identical references', () => {
    const o = { a: 1 };
    expect(shallowEqual(o, o)).toBe(true);
  });

  it('returns true for primitives via Object.is', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual('x', 'x')).toBe(true);
    expect(shallowEqual(NaN, NaN)).toBe(true);   // Object.is handles NaN correctly
    expect(shallowEqual(0, -0)).toBe(false);     // Object.is distinguishes ±0
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(undefined, undefined)).toBe(true);
  });

  it('returns false for null vs object', () => {
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual({}, null)).toBe(false);
  });

  it('returns false for objects of different key sets', () => {
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('returns true for shallow-equal objects', () => {
    expect(shallowEqual({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
  });

  it('returns false for nested-object diff (only shallow check)', () => {
    expect(shallowEqual({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false);  // different nested identity
  });
});
