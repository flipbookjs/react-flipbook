/**
 * Shared wheel-event throttle window — 150ms leading-edge.
 *
 * Consumed by:
 * - `routeWheelEvent` (zoom-side) for Ctrl/Cmd+wheel throttle (Decision 11 Case 1).
 *   Limits zoom dispatch rate to ~6-7 steps/sec under held wheel.
 * - `decideCurlWheelDispatch` (curl-side) for the plain-wheel cooldown.
 *   Preserved from old fork's usePageCurlGesture.ts:13 (WHEEL_COOLDOWN_MS).
 *
 * Single source of truth: tuning this value updates BOTH the zoom-side and
 * curl-side wheel pacing, preserving the symmetry intent that they feel like
 * the same gesture rate to the user.
 */
export const WHEEL_THROTTLE_MS = 150;
