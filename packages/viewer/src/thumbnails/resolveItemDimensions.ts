import { devWarn } from '../core/devWarn';

/**
 * Density target counts — how many median-width thumbnails (plus their
 * inter-thumb gaps) fit across the panel's content box. Not exported,
 * not part of the public API. The prop's documented contract is "the
 * target depends on the density token," not "compact = 16" — changing
 * these constants in a future MINOR release would be a consumer-visible
 * visual change but not an API break per MIGRATION.md §10.
 *
 * Calibration: targets are tuned so `'comfortable'` produces ~100-180 px
 * wide thumbnails across the typical desktop / laptop / panel viewport
 * range, matching the navigation-strip aesthetic of Adobe Acrobat /
 * Mozilla PDF.js / macOS Preview. On viewports below ~1000 px the floor
 * (80 px) engages and fewer thumbnails are visible — correct degradation.
 */
const DENSITY_TARGET = { compact: 16, comfortable: 10, spacious: 6 } as const;

export type Density = 'compact' | 'comfortable' | 'spacious';

const MIN_THUMB_WIDTH = 80;   // WCAG 2.5.5 touch-target advisory floor
const MAX_THUMB_WIDTH = 2048; // backing-store ceiling — matches 1.x cap

// Module-level dedup Sets — same pattern as `warnedDeprecations` in
// Flipbook.tsx:21 and `warnedSizes` in 1.x ThumbnailPanel.tsx:30. The
// entire dedup body is gated on `process.env.NODE_ENV !== 'production'`
// via the early-return; bundlers DCE both the Set.has/Set.add calls AND
// the devWarn call in production builds, so the production cost is zero
// bytes.
const warnedWidths = new Set<unknown>();
function warnOnceForBadWidth(badValue: unknown, message: string): void {
  if (process.env.NODE_ENV === 'production') return;
  if (warnedWidths.has(badValue)) return;
  warnedWidths.add(badValue);
  devWarn(message);
}

const warnedDensities = new Set<unknown>();
function warnOnceForBadDensity(badValue: unknown): void {
  if (process.env.NODE_ENV === 'production') return;
  if (warnedDensities.has(badValue)) return;
  warnedDensities.add(badValue);
  devWarn(
    `ThumbnailPanel: thumbnailDensity=${JSON.stringify(badValue)} is not one of 'compact' / 'comfortable' / 'spacious'; falling back to 'comfortable'.`,
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Textbook median: middle element for odd-N, average of two middle elements
 * for even-N. `medianOf([612, 792])` returns `702`, not `792`. Returns `1`
 * for the empty-input sentinel (never multiply by 0 downstream).
 *
 * Pure function — exported for the unit test in __tests__/thumbnailSize.test.tsx
 * (internal import path; not surfaced via package index.ts).
 */
export function trueMedian(sortedAscending: number[]): number {
  const n = sortedAscending.length;
  if (n === 0) return 1;
  const mid = Math.floor(n / 2);
  return n % 2 === 1
    ? sortedAscending[mid]
    : (sortedAscending[mid - 1] + sortedAscending[mid]) / 2;
}

/**
 * Resolve per-page thumbnail dimensions for the 2.0 sizing API.
 *
 * Resolution order:
 *
 *   1. `explicitWidth` supplied + meaningfully invalid (NaN / Infinity / ≤ 0):
 *      dev-warn (once per bad value), fall through to density resolution.
 *      The value is unrecoverable garbage; falling back to a sensible
 *      density default is better than picking an arbitrary number.
 *
 *   2. `explicitWidth` supplied + finite + positive: `clamp(value, 80, 2048)`.
 *      Values above 2048 warn AND clamp; values below 80 clamp silently
 *      (the floor is the documented WCAG touch-target advisory).
 *      Container width, reference width, and gap are ignored.
 *
 *   3. Density resolution (supplied token, `'comfortable'` default for
 *      both-omitted, or fall-through from (1)). Sanitize first: if
 *      `density` is supplied but not a member of
 *      {'compact','comfortable','spacious'} (JS-side bypass — TypeScript
 *      prevents this for typed callers), dev-warn and substitute
 *      'comfortable'. Then compute:
 *
 *        target = DENSITY_TARGET[density]
 *        gapsTotal = (target - 1) × gapPx
 *        unitWidth = (containerContentWidth - gapsTotal) / target
 *        rawWidth = unitWidth × (pageSize.width / referenceWidth)
 *        width = clamp(Math.floor(rawWidth), 80, 2048)
 *
 *      `Math.floor` (not `Math.round`) guarantees the Nth thumbnail's
 *      right edge stays within the visible boundary after gap accounting.
 *      Rounding could push a one-pixel overflow that triggers a horizontal
 *      scrollbar on first paint.
 *
 * Height per thumbnail: `Math.round(width × pageSize.height / pageSize.width)`.
 * Scale (for the canvas backing-store render, DPR not included):
 * `width / pageSize.width`. Same math as 1.x.
 *
 * Pure function — exported for the unit test in __tests__/thumbnailSize.test.tsx
 * (internal import path; not surfaced via package index.ts).
 */
export function resolveItemDimensions(
  density: Density | undefined,
  explicitWidth: number | undefined,
  pageSize: { width: number; height: number },
  containerContentWidth: number,
  referenceWidth: number,
  gapPx: number,
): { width: number; height: number; scale: number } {
  let resolvedWidth: number;

  if (explicitWidth !== undefined) {
    // Step 1: invalid garbage → warn + fall through to density.
    if (!Number.isFinite(explicitWidth) || explicitWidth <= 0) {
      warnOnceForBadWidth(
        explicitWidth,
        `ThumbnailPanel: thumbnailWidth=${explicitWidth} is not a valid positive width; falling back to 'comfortable' density.`,
      );
      resolvedWidth = resolveDensityWidth(density, pageSize, containerContentWidth, referenceWidth, gapPx);
    } else {
      // Step 2: in-range pass-through (with floor + ceiling clamps).
      if (explicitWidth > MAX_THUMB_WIDTH) {
        warnOnceForBadWidth(
          explicitWidth,
          `ThumbnailPanel: thumbnailWidth=${explicitWidth} exceeds MAX_THUMB_WIDTH (${MAX_THUMB_WIDTH}); clamping.`,
        );
      }
      resolvedWidth = clamp(explicitWidth, MIN_THUMB_WIDTH, MAX_THUMB_WIDTH);
    }
  } else {
    // Step 3: density resolution (no explicitWidth supplied).
    resolvedWidth = resolveDensityWidth(density, pageSize, containerContentWidth, referenceWidth, gapPx);
  }

  const height = Math.round(resolvedWidth * pageSize.height / pageSize.width);
  const scale = resolvedWidth / pageSize.width;
  return { width: resolvedWidth, height, scale };
}

function resolveDensityWidth(
  density: Density | undefined,
  pageSize: { width: number; height: number },
  containerContentWidth: number,
  referenceWidth: number,
  gapPx: number,
): number {
  // Sanitize the density token at the API boundary. TypeScript prevents
  // typed callers from passing an unknown string here; this branch is the
  // JS-side bypass guard (consumer passing `as any` or calling from
  // untyped JS). Without it, `DENSITY_TARGET[badToken]` returns undefined
  // → NaN propagates through the math → broken canvases with no diagnostic.
  let safeDensity: Density;
  if (density === undefined) {
    safeDensity = 'comfortable';
  } else if (density === 'compact' || density === 'comfortable' || density === 'spacious') {
    safeDensity = density;
  } else {
    warnOnceForBadDensity(density);
    safeDensity = 'comfortable';
  }

  const target = DENSITY_TARGET[safeDensity];
  const gapsTotal = (target - 1) * gapPx;
  const unitWidth = (containerContentWidth - gapsTotal) / target;
  const rawWidth = unitWidth * (pageSize.width / referenceWidth);
  return clamp(Math.floor(rawWidth), MIN_THUMB_WIDTH, MAX_THUMB_WIDTH);
}
