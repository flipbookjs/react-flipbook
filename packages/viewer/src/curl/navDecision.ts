/**
 * Pure function deciding how a programmatic adjacent navigation (arrows, toolbar
 * prev/next, keyboard ←/→, `actions.next()/previous()`) should resolve when the
 * curl engine is present. Sibling of `decideCurlWheelDispatch`, but:
 *
 *  - No cooldown gate — clicks / keypresses are discrete, not a wheel stream.
 *  - Three-state result (`curl | snap | ignore`) instead of fire/no-fire: a
 *    declined curl must fall back to a plain snap so a click is never a no-op,
 *    whereas a declined wheel event is simply dropped.
 *
 * Reduced motion is NOT an input here. It is handled upstream by gating the
 * `CurlOverlay` render (FlipbookProvider): under reduced motion the overlay, and
 * therefore this handler, is never mounted — so `navigateAdjacent` snaps.
 */

export interface CurlNavDecisionInputs {
  direction: 'next' | 'previous';
  isAnimating: boolean;
  hasNextSpread: boolean;
  hasPreviousSpread: boolean;
  nextBitmapReady: boolean;
  prevBitmapReady: boolean;
}

/**
 * - `curl`   — start the curl animation for this direction.
 * - `snap`   — the caller dispatches the plain spread change (no curl).
 * - `ignore` — no-op: already animating, or already at the first/last edge.
 */
export type CurlNavDecision = 'curl' | 'snap' | 'ignore';

export function decideCurlNavDispatch(inputs: CurlNavDecisionInputs): CurlNavDecision {
  const { direction, isAnimating, hasNextSpread, hasPreviousSpread,
          nextBitmapReady, prevBitmapReady } = inputs;

  // Busy gate — drop repeat input while a curl is in flight (matches wheel).
  if (isAnimating) return 'ignore';

  // Edge gate — no adjacent spread to move to; nothing to do either way.
  const hasTarget = direction === 'next' ? hasNextSpread : hasPreviousSpread;
  if (!hasTarget) return 'ignore';

  // Readiness gate — the target tier bitmap must be decoded for the curl to
  // render. If it isn't ready yet, snap instead of dropping the input, so the
  // arrow / key still navigates.
  const bitmapReady = direction === 'next' ? nextBitmapReady : prevBitmapReady;
  if (!bitmapReady) return 'snap';

  return 'curl';
}
