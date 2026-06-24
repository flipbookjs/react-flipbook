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
} from './PreRenderedPageSource';
