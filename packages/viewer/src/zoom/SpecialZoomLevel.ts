/**
 * String enum adapted from the old fork's `packages/core/src/structs/SpecialZoomLevel.ts`.
 * Member NAMES are preserved verbatim (ActualSize, PageFit, PageWidth) so CMS code passing
 * `SpecialZoomLevel.PageFit` continues to typecheck against the old import. Member VALUES
 * for PageFit and PageWidth are intentionally changed from the old fork's `'PageFit'` /
 * `'PageWidth'` to `'fit-page'` / `'fit-width'` (the new viewer's `defaultScale` string
 * union members). See "Note" below the enum + Decision 5 in the architectural plan.
 *
 * - PageFit → resolves to `{ zoomMode: 'fit-page', customScale: 1 }` in the factory
 * - PageWidth → `{ zoomMode: 'fit-width', customScale: 1 }`
 * - ActualSize → `{ zoomMode: 'custom', customScale: 1 }` (1 CSS pixel per PDF point at default DPR)
 */
export enum SpecialZoomLevel {
  ActualSize = 'ActualSize',
  PageFit = 'fit-page',
  PageWidth = 'fit-width',
}
