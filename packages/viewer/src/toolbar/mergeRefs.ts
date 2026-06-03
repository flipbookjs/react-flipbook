import type { Ref } from 'react';
import { devWarn } from '../core/devWarn';

/**
 * Merge multiple refs into a single ref callback. Each ref receives the same
 * node. Supports both callback refs and `RefObject<T>` refs (the `.current`-
 * assignment kind), including React 19's ref-cleanup return-value pattern.
 *
 * Why this exists: built-in toolbar buttons need an internal ref (from
 * `useToolbarPart`, for the shell's focus-management) AND must forward the
 * consumer's ref (so a consumer can `useRef<HTMLButtonElement>` + pass to
 * `<PrevButton ref={myRef} />` and programmatically focus it). Without
 * merging, the consumer's ref is dropped — common library footgun.
 *
 * **React 19 ref-cleanup support.** React 19 ref callbacks can return a
 * cleanup function: `(node) => () => cleanup`. The cleanup runs when the
 * ref is detached, replacing the older "callback called with null" pattern.
 * `mergeRefs` collects cleanups from each inner callback ref and returns
 * a composite cleanup that runs them in REVERSE order (matching React's
 * useEffect-cleanup convention: most-recently-added runs first). Inner refs
 * that don't return cleanup are still called with `null` on detach via the
 * legacy code path that React invokes on each new ref callback identity.
 *
 * **Exception isolation.** If one inner ref throws (e.g., a consumer ref
 * callback errors), the loop catches the exception via `devWarn` and
 * continues with the remaining refs. Without this, a buggy consumer ref
 * would prevent the internal `useToolbarPart` ref from updating, leaving
 * `partsRef` stale — silent breakage of the shell's focus management.
 *
 * **Rule 1 trade-off — acknowledged.** The catch + devWarn pattern means a
 * thrown consumer ref is silently swallowed in production builds (where
 * `devWarn` is a no-op due to NODE_ENV stripping). This is a deliberate
 * trade-off: the alternative — letting one consumer ref's exception block
 * notification of all OTHER refs in the list — would silently leak the
 * internal ref (Rule 6 violation). We chose isolation over loud-failure
 * because the load-bearing invariant here is "partsRef stays accurate";
 * losing visibility of consumer-side bugs is the lesser cost. Production-
 * observability for ref-callback failures requires a separate
 * error-reporting surface (e.g., a `state.lastRefError` field) — out of
 * scope for 6B; tracked as a future hardening item.
 *
 * **Stable identity is the caller's job.** The function itself allocates
 * a new callback on every call. Callers needing identity stability across
 * renders MUST wrap in `useMemo([])` or `useCallback([])` with the input
 * refs in deps. Without stabilization, React detaches/re-attaches the ref
 * on every render — observable in dev tools and produces a brief
 * `null` window for `partsRef.current.get(id)?.current` (review finding T2).
 * All built-in buttons use `useMemo`; consumer parts must do the same.
 */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => (() => void) | undefined {
  return (node: T | null) => {
    // Detach call (React 18 pattern: ref called with null). Reset RefObject
    // refs + call callback refs with null. New-style refs that returned a
    // cleanup have already had it invoked by React's separate cleanup path,
    // so we don't double-call. We can't distinguish at this point, but
    // calling old-style refs with null is idempotent (they handle null).
    if (node === null) {
      for (const ref of refs) {
        try {
          if (typeof ref === 'function') {
            ref(null);
          } else if (ref != null) {
            (ref as { current: T | null }).current = null;
          }
        } catch (err) {
          devWarn('[flipbook] mergeRefs: a ref threw during null-detach; continuing.', err);
        }
      }
      return undefined;
    }

    // Attach call (React calls with a node). Iterate refs, collect any
    // React-19-style cleanups returned from inner callback refs, set
    // RefObject .current values, and ALWAYS return a composite cleanup
    // that resets everything on unmount.
    const cleanups: Array<() => void> = [];
    for (const ref of refs) {
      try {
        if (typeof ref === 'function') {
          const result = ref(node);
          if (typeof result === 'function') {
            cleanups.push(result);
          }
          // Old-style callback refs (no return) don't accumulate cleanups.
          // The composite cleanup below calls them with null, so they get
          // their expected detach signal regardless.
        } else if (ref != null) {
          // RefObject<T> — mutable. The `as` cast is safe because RefObject's
          // `.current` is declared readonly in React 19's types but the actual
          // runtime is mutable; this is the standard pattern in every ref-
          // merging utility in the React ecosystem.
          (ref as { current: T | null }).current = node;
        }
      } catch (err) {
        devWarn('[flipbook] mergeRefs: a ref callback threw; continuing with the remaining refs.', err);
      }
    }

    // ALWAYS return a composite cleanup — even if no inner ref returned one.
    // Critical correctness fix (review finding H-§1.1): if mergeRefs returned
    // `undefined` here when some inner refs returned cleanups, React 19 would
    // call composedRef(null) on unmount (because we said "no cleanup"), and
    // the inner cleanups would NEVER run. Conversely if we returned a cleanup
    // ONLY when at least one inner ref had a cleanup, old-style inner refs
    // would never receive `null` on unmount (because React, seeing a cleanup,
    // would skip the `null` detach call) — leaking those refs. The unified
    // contract: ALWAYS return a cleanup that handles ALL ref kinds, so both
    // React 18 and React 19 unmount paths converge on correct teardown.
    return () => {
      // Run React-19-style cleanups in REVERSE order (matches useEffect
      // cleanup convention: most-recently-added runs first).
      for (let i = cleanups.length - 1; i >= 0; i--) {
        try { cleanups[i](); }
        catch (err) { devWarn('[flipbook] mergeRefs: a cleanup callback threw; continuing.', err); }
      }
      // Reset RefObject refs + call old-style callback refs with null. We
      // call ALL function refs with null (not just the ones without cleanups)
      // because we can't tell them apart at this point — a new-style ref
      // receiving an extra `null` call is harmless idempotency; an old-style
      // ref NOT receiving it would leak. Bias toward the safe overcall.
      for (const ref of refs) {
        try {
          if (typeof ref === 'function') {
            ref(null);
          } else if (ref != null) {
            (ref as { current: T | null }).current = null;
          }
        } catch (err) {
          devWarn('[flipbook] mergeRefs: a ref threw during composite-cleanup detach; continuing.', err);
        }
      }
    };
  };
}
