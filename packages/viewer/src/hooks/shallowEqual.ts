/**
 * Shallow equality check — compares own enumerable keys with Object.is.
 * Documented as the recommended `isEqual` arg for `useFlipbookSelector` when
 * the selector returns an object literal. Without this, the default Object.is
 * always returns false for new object identities and the component re-renders
 * every dispatch, defeating the perf benefit.
 *
 * Returns true iff:
 *   - a and b are the same reference (fast path), OR
 *   - both are non-null objects of the same key set with Object.is-equal values
 *     for every key.
 *
 * Handles NaN correctly via Object.is (Object.is(NaN, NaN) === true).
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    )) return false;
  }
  return true;
}
