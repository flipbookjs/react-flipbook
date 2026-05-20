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
}

export const FlipbookContext = createContext<FlipbookContextValue | null>(null);

export function useFlipbook(): FlipbookContextValue {
  const ctx = useContext(FlipbookContext);
  if (ctx === null) throw new Error('useFlipbook must be used within FlipbookProvider');
  return ctx;
}
