import { createContext, useContext, type Dispatch } from 'react';
import type { FlipbookState, FlipbookAction } from './flipbookReducer';
import type { Spread } from './computeSpreads';
import type { PageSource } from '../types/PageSource';

export interface FlipbookContextValue {
  state: FlipbookState;
  dispatch: Dispatch<FlipbookAction>;
  source: PageSource;
  spreads: Spread[];
  effectiveScale: number;
  /** True when scaled spread overflows the container in either dimension
   *  (Decision 10). Consumers use this to gate curl, switch touch-action
   *  on the stage, etc. Computed in FlipbookProvider's effectiveScale useMemo. */
  isOverflowing: boolean;
  /** Curl module registers its plain-wheel callback via this setter. FlipbookProvider
   *  owns the wheel listener (Decision 11); curl plugs in here. Passing null
   *  unregisters. Ref-backed — no re-render on registration. */
  registerCurlWheelHandler: (
    handler: ((direction: 'next' | 'previous') => void) | null,
  ) => void;
  // ---- Step 6A additions (Decision 1 of step-6-architectural-plan.md) ----
  /** Mirrors `usePageSource.SourceState.status`. The public `useFlipbook` hook
   *  maps this to the top-level `status` field of the discriminated `FlipbookHook`.
   *  No corresponding reducer field — source lifecycle isn't reducer-managed. */
  sourceStatus: 'loading' | 'ready' | 'error';
  /** Populated when sourceStatus === 'error'; null otherwise. Mirrors
   *  `usePageSource.SourceState.error`. */
  sourceError: Error | null;
}

export const FlipbookContext = createContext<FlipbookContextValue | null>(null);

/**
 * Internal hook returning the raw FlipbookContextValue. NOT re-exported from
 * src/index.ts. Public consumers should use the curated `useFlipbook` from
 * src/hooks/useFlipbook.ts instead — that hook returns a discriminated-union
 * shape with stable references and no internal-context fields like
 * `registerCurlWheelHandler`.
 *
 * Renamed from `useFlipbook` in 6A so the public-hook name is freed.
 * Internal call sites: useCurlMode, CurlOverlay, useCurlAnimation,
 * AriaAnnouncer, SpreadRenderer.
 */
export function useFlipbookContext(): FlipbookContextValue {
  const ctx = useContext(FlipbookContext);
  if (ctx === null) throw new Error('useFlipbookContext must be used within FlipbookProvider');
  return ctx;
}
