import { useDebugValue, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

/**
 * Local implementation of the selector variant of `useSyncExternalStore`.
 *
 * The official `use-sync-external-store/shim/with-selector` npm package
 * exists because React 17 didn't ship `useSyncExternalStore` natively;
 * the shim provides it plus a memoizing selector wrapper. React 18+ has
 * the base hook natively, but the SELECTOR variant is still not on
 * `react`, so projects routinely pull in the shim package.
 *
 * The shim is published as CJS-only. When bundlers (rolldown/Rollup)
 * build our library for ESM and treat `react` as external, the shim's
 * internal `require('react')` call survives into the output. Browsers
 * loading the ESM build then crash with "Calling `require` for 'react'
 * in an environment that doesn't expose the `require` function".
 *
 * Inlining the hook here removes the dependency entirely and makes the
 * ESM output clean. The implementation is transcribed from React's
 * official source (packages/use-sync-external-store/src/useSyncExternalStoreWithSelector.js)
 * — same algorithm, same caching strategy, same `Object.is`-fallback
 * semantics. The only practical difference from the npm shim is that on
 * React 17 this code would not work (no `useSyncExternalStore`), which
 * is fine — our peer-dep is `react >= 18`.
 */

type Subscribe = (onStoreChange: () => void) => () => void;

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: Subscribe,
  getSnapshot: () => Snapshot,
  getServerSnapshot: undefined | (() => Snapshot),
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  // Memoized selection state lives in a ref so each call sees the prior
  // selection without re-deriving. Used by the equality short-circuit
  // below: when `isEqual(prev, next)` returns true we return the prior
  // selection by identity, avoiding re-renders downstream.
  const instRef = useRef<{ hasValue: boolean; value: Selection | null } | null>(null);
  let inst: { hasValue: boolean; value: Selection | null };
  if (instRef.current === null) {
    inst = { hasValue: false, value: null };
    instRef.current = inst;
  } else {
    inst = instRef.current;
  }

  const [getSelection, getServerSelection] = useMemo(() => {
    // Closure-local memo of `(lastSnapshot, lastSelection)` so back-to-back
    // calls with the same snapshot avoid re-running the selector AND so
    // equality-equal selections preserve the previous selection identity.
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;

    function memoizedSelector(nextSnapshot: Snapshot): Selection {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        // First call: if we have a prior selection from a previous render
        // commit AND `isEqual` says it equals what we just derived, prefer
        // the prior reference so consumers comparing by identity (e.g.,
        // React's `===` bailout) see no change.
        if (isEqual !== undefined && inst.hasValue) {
          const currentSelection = inst.value as Selection;
          if (isEqual(currentSelection, nextSelection)) {
            memoizedSelection = currentSelection;
            return currentSelection;
          }
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }

      const prevSnapshot = memoizedSnapshot;
      const prevSelection = memoizedSelection;
      // Snapshot identity unchanged — selector is pure, prior selection is valid.
      if (Object.is(prevSnapshot, nextSnapshot)) {
        return prevSelection;
      }

      const nextSelection = selector(nextSnapshot);
      // Selections equal under `isEqual` (e.g., shallowEqual for object slices)
      // — preserve prior reference. This is the load-bearing line for
      // selector-based render skipping.
      if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return prevSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    }

    const maybeGetServerSnapshot = getServerSnapshot === undefined ? null : getServerSnapshot;
    const getSnapshotWithSelector = () => memoizedSelector(getSnapshot());
    const getServerSnapshotWithSelector = maybeGetServerSnapshot === null
      ? undefined
      : () => memoizedSelector(maybeGetServerSnapshot());
    return [getSnapshotWithSelector, getServerSnapshotWithSelector] as const;
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

  useEffect(() => {
    inst.hasValue = true;
    inst.value = value;
  }, [value]);

  useDebugValue(value);
  return value;
}
