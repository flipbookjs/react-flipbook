import type { Spread } from '../core/computeSpreads';

export type SpreadAdjacency = 'same' | 'next' | 'previous' | 'non-adjacent';

/**
 * Given the current spread index and a target spread index, determines the
 * relationship between them. Used by curl gesture handlers to decide if a
 * page change can be animated as a curl or must be an instant snap.
 *
 * Adapted from old fork's getSpreadAdjacency.ts which used getSpreadFirstIndex
 * helper. The new viewer's reducer maintains a spreads array directly (Step 2),
 * so adjacency is just an index comparison.
 */
export function getSpreadAdjacency(
  currentSpreadIndex: number,
  targetSpreadIndex: number,
  spreads: Spread[],
): SpreadAdjacency {
  if (currentSpreadIndex === targetSpreadIndex) return 'same';
  if (currentSpreadIndex < 0 || targetSpreadIndex < 0) return 'non-adjacent';
  if (currentSpreadIndex >= spreads.length || targetSpreadIndex >= spreads.length) return 'non-adjacent';
  if (targetSpreadIndex === currentSpreadIndex + 1) return 'next';
  if (targetSpreadIndex === currentSpreadIndex - 1) return 'previous';
  return 'non-adjacent';
}
