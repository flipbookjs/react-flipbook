/**
 * Pure function deciding whether the curl-side wheel callback should fire
 * `actions.startAnimatedCurl(direction)` given current gate state. Extracted
 * from useCurlMode's registered handler — symmetric with `routeWheelEvent`
 * on the zoom side. Table-driven unit-testable.
 *
 * The gates encode the old fork's wheel preconditions (animating-check,
 * cooldown, direction preconditions, bitmap readiness) that previously lived
 * inline in `usePageCurlGesture.handleWheel` (now deleted). useCurlMode's
 * registered handler wraps this in a few lines that read live refs and apply
 * the decision.
 */

export interface CurlWheelDecisionInputs {
  direction: 'next' | 'previous';
  isAnimating: boolean;
  hasNextSpread: boolean;
  hasPreviousSpread: boolean;
  nextBitmapReady: boolean;
  prevBitmapReady: boolean;
  lastWheelTimestamp: number;
  now: number;
  cooldownMs: number;
}

/**
 * Discriminated union on `fire` — parallels `WheelRoute`'s `kind` discriminant
 * on the zoom side. Caller narrows via `if (decision.fire) { ... }` and accesses
 * `decision.newLastWheelTimestamp` without a non-null assertion. tsc enforces
 * the contract: a bug in the pure function that returned `{ fire: true }` without
 * the timestamp would fail to compile.
 */
export type CurlWheelDecision =
  | { fire: false }
  | { fire: true; newLastWheelTimestamp: number };

export function decideCurlWheelDispatch(inputs: CurlWheelDecisionInputs): CurlWheelDecision {
  const { direction, isAnimating, hasNextSpread, hasPreviousSpread,
          nextBitmapReady, prevBitmapReady, lastWheelTimestamp, now, cooldownMs } = inputs;

  // Busy gate (preserved from old fork).
  if (isAnimating) return { fire: false };
  // Cooldown gate.
  if (now - lastWheelTimestamp < cooldownMs) return { fire: false };
  // Decision 11 preconditions — direction-specific.
  if (direction === 'next' && (!hasNextSpread || !nextBitmapReady)) return { fire: false };
  if (direction === 'previous' && (!hasPreviousSpread || !prevBitmapReady)) return { fire: false };

  return { fire: true, newLastWheelTimestamp: now };
}
