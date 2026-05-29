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
}

export const FlipbookContext = createContext<FlipbookContextValue | null>(null);

export function useFlipbook(): FlipbookContextValue {
  const ctx = useContext(FlipbookContext);
  if (ctx === null) throw new Error('useFlipbook must be used within FlipbookProvider');
  return ctx;
}
