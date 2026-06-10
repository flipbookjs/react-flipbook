import type { Spread } from '../core/computeSpreads';

/**
 * Consolidated spread-geometry snapshot. Derived once per render from `spreads`
 * and `currentSpreadIndex`; consumed by gesture preconditions, overlay-rect
 * measurement, and the render callback.
 *
 * Solo shapes:
 * - `currentSpread.left === null` ⇒ cover (visible page on right)
 * - `currentSpread.right === null` ⇒ last-solo (visible page on left)
 * - otherwise: dual.
 */
export interface SpreadGeometry {
  /** Page indices of the CURRENT spread, left-to-right. */
  currentPages: number[];
  /** Page indices of the NEXT spread (empty if at end). */
  nextPages: number[];
  /** Page indices of the PREVIOUS spread (empty if at start). */
  previousPages: number[];
  /** Solo shape of the current spread (null when dual). Check `!== null` for solo-ness. */
  currentSoloShape: 'cover' | 'last-solo' | null;
  /** Solo shape of the next spread (null when dual or out-of-range). */
  nextSoloShape: 'cover' | 'last-solo' | null;
  /** Solo shape of the previous spread (null when dual or out-of-range). */
  previousSoloShape: 'cover' | 'last-solo' | null;
}

function flattenSpread(spread: Spread | undefined): number[] {
  if (!spread) return [];
  const out: number[] = [];
  if (spread.left !== null) out.push(spread.left);
  if (spread.right !== null) out.push(spread.right);
  return out;
}

/**
 * Returns the solo shape of a spread by checking which side is null.
 *
 * Note: in single view mode, computeSpreads returns `{left: null, right: i}` for every
 * spread, so this function labels every single-mode spread as `'cover'`. This is harmless
 * because the only consumers of solo-shape data (useCurlOverlayRect's rect expansion +
 * useCurlRenderCallback's offset math) gate on `resolvedViewMode === 'dual-cover'` before
 * reading the shape.
 */
function deriveSoloShape(spread: Spread | undefined): 'cover' | 'last-solo' | null {
  if (!spread) return null;
  if (spread.left === null && spread.right !== null) return 'cover';
  if (spread.right === null && spread.left !== null) return 'last-solo';
  return null;
}

/**
 * Derive SpreadGeometry from the spreads array + currentSpreadIndex. Pure.
 * Callers wrap in useMemo with deps `[spreads, currentSpreadIndex]` for stability.
 */
export function deriveSpreadGeometry(
  spreads: Spread[],
  currentSpreadIndex: number,
): SpreadGeometry {
  const current = spreads[currentSpreadIndex];
  const next = spreads[currentSpreadIndex + 1];
  const previous = spreads[currentSpreadIndex - 1];

  const currentSoloShape = deriveSoloShape(current);

  return {
    currentPages: flattenSpread(current),
    nextPages: flattenSpread(next),
    previousPages: flattenSpread(previous),
    currentSoloShape,
    nextSoloShape: deriveSoloShape(next),
    previousSoloShape: deriveSoloShape(previous),
  };
}
