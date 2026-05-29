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
}

export const FlipbookContext = createContext<FlipbookContextValue | null>(null);

export function useFlipbook(): FlipbookContextValue {
  const ctx = useContext(FlipbookContext);
  if (ctx === null) throw new Error('useFlipbook must be used within FlipbookProvider');
  return ctx;
}
