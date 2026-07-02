// @flipbookjs/api-adapter — public surface (semver-stable from 1.0.0).
export { PreRenderedPageSource } from './PreRenderedPageSource';
export type {
  PreRenderedPageSourceOptions,
  Manifest,
  // 8a Phase G additions — additive on the public surface (1.2.0 minor bump).
  SearchOptions,
  SearchHit,
  SearchIndexEnvelope,
  InvertedIndex,
  SortedPositionalIndex,
  // 8b additions — additive on the public surface (1.3.0 minor bump).
  ReadingOrder,
  ReadingOrderBlock,
  ReadingOrderBlockKind,
  ReadingOrderSource,
  ReadingOrderOptions,
  // 8c additions — additive on the public surface (1.4.0 minor bump).
  PageAccessibility,
  AccessibilityReport,
  AccessibilityRegion,
  AccessibilityHeading,
  AccessibilityAltText,
  AccessibilityOptions,
  AccessibilitySource,
  RemediationStatus,
} from './PreRenderedPageSource';

// 1.5.0 additions — additive public surface.
export { createFlipbookSource } from './createFlipbookSource';
export type { CreateFlipbookSourceOptions } from './createFlipbookSource';
export type {
  FlipbookDocument,
  FlipbookDocumentStatus,
} from './FlipbookDocument';
