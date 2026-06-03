import { createContext, useContext } from 'react';
import type { FlipbookSnapshot } from '../hooks/useFlipbook';

/**
 * Snapshot-store contract for `useSyncExternalStoreWithSelector`. Lives on a
 * SECOND context (separate from FlipbookContext) so:
 *   1. Internal consumers reading `ctx.state` via `useFlipbookContext()` are
 *      not forced through the store layer.
 *   2. The store-layer surface stays narrow (3 stable function refs).
 *
 * Mounted by FlipbookProvider; consumed by useFlipbookSelector (and via that,
 * by useFlipbook and useFlipbookActions).
 *
 * Note on the cross-module type import: `FlipbookSnapshot` lives in
 * `src/hooks/useFlipbook.ts`. The import is type-only (erased at compile
 * time) and does NOT create a runtime circular dependency — `useFlipbook.ts`
 * imports `FlipbookStoreContext` from this file at runtime, but does not
 * re-export it. The cycle is type-only; both files compile in any order.
 */
export interface FlipbookStoreContextValue {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => FlipbookSnapshot;
  getServerSnapshot: () => FlipbookSnapshot;
}

export const FlipbookStoreContext = createContext<FlipbookStoreContextValue | null>(null);

export function useFlipbookStore(): FlipbookStoreContextValue {
  const ctx = useContext(FlipbookStoreContext);
  if (ctx === null) throw new Error('useFlipbookStore must be used within FlipbookProvider');
  return ctx;
}
