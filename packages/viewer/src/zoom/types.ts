/**
 * Public-facing union type for the `defaultScale` prop on `<Flipbook>` (5B)
 * AND the `defaultScale` parameter on `createInitialState` (5A factory).
 *
 * Single source of truth so adding a new sentinel later (e.g., a hypothetical
 * 'PageActual') needs only one update site, not three (factory + reducer
 * helper + Flipbook prop). L1 fix from pass-2 review.
 *
 * - 'fit-page' → reducer state { zoomMode: 'fit-page', customScale: 1 }
 * - 'fit-width' → { zoomMode: 'fit-width', customScale: 1 }
 * - 'ActualSize' → { zoomMode: 'custom', customScale: 1 } (SpecialZoomLevel sentinel)
 * - number → { zoomMode: 'custom', customScale: clampCustomScale(n) }
 *
 * `SpecialZoomLevel.PageFit` and `SpecialZoomLevel.PageWidth` typecheck against
 * the string union members because TypeScript string-enum members have type
 * equal to their literal value. `'ActualSize'` is the only sentinel without an
 * equivalent fit-mode name in the union; including it explicitly closes the gap
 * (see Decision 1 + Decision 5 in the architectural plan).
 */
export type DefaultScale = 'fit-page' | 'fit-width' | 'ActualSize' | number;
