/**
 * Minimum allowed zoom scale. Factory + reducer both clamp to this floor.
 * Co-located with LEVELS because both are zoom-domain constants tightly
 * coupled to the array's bounds (M2 fix from pass-2 review — was previously
 * in flipbookReducer.ts, which is semantically wrong: cap values are
 * zoom-domain concepts, not reducer concepts).
 */
export const MIN_SCALE = 0.1;

/**
 * Maximum allowed zoom scale per architectural plan Decision 6. Cap of 4 keeps
 * worst-case canvas backing-store memory at ~123 MB on retina/mobile devices
 * (600×800 page × 4 scale × 2 DPR = 192M pixels × 4 bytes RGBA = 123 MB),
 * comfortably below iOS Safari's reported ~256 MB ceiling. Adaptive per-device
 * caps (desktop non-retina could safely go to 10) are deferred to v0.2.
 */
export const MAX_SCALE = 4;

/**
 * Discrete zoom levels for stepped zoom-in / zoom-out. Algorithm (increase /
 * decrease) ported verbatim from old fork's `packages/core/src/zoom/zoomingLevel.ts`.
 * LEVELS array preserves the old fork's distribution from 0.1 through 3.7
 * verbatim (finer near 1x where small steps matter most), but the terminal
 * value is `4` (single boundary, equal to MAX_SCALE) instead of the old fork's
 * `4.1, 4.6, ..., 10` tail.
 *
 * Rationale for the one-value deviation: if LEVELS extended past MAX_SCALE,
 * `increase(3.7)` would return `4.1`, the reducer would clamp it to `4`, and
 * the user would get silent dead clicks at the ceiling. Ending LEVELS at exactly
 * MAX_SCALE makes `increase(3.7) === 4` (one step to ceiling) and `increase(4)`
 * returns `4` via the `|| currentLevel` fallback — idempotent at the cap.
 */
const LEVELS = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.3, 1.5, 1.7, 1.9,
  2.1, 2.4, 2.7, 3.0, 3.3, 3.7, 4,
];

export const increase = (currentLevel: number): number => {
  const found = LEVELS.find((item) => item > currentLevel);
  return found || currentLevel;
};

export const decrease = (currentLevel: number): number => {
  const found = LEVELS.findIndex((item) => item >= currentLevel);
  return found === -1 || found === 0 ? currentLevel : LEVELS[found - 1];
};
