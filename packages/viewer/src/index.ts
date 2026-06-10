// Styles — must be imported for Vite to include in the CSS bundle.
// Users import separately: import '@flipbookjs/react-viewer/styles.css'
import './styles/flipbook.css';

// Components
export { Flipbook } from './Flipbook';
export type { FlipbookProps } from './Flipbook';

// Toolbar (Step 6C)
export { Toolbar } from './toolbar/Toolbar';
export type { ToolbarProps } from './toolbar/Toolbar';

// Thumbnail panel (Step 6D)
export { ThumbnailPanel } from './thumbnails/ThumbnailPanel';

// PageSource interface
export type {
  PageSource,
  TextItem,
  LinkAnnotation,
  OutlineItem,
} from './types/PageSource';

// Spread data shape — stable across Step 2 and beyond. Internal reducer state
// (FlipbookState/FlipbookAction) stays unexported until the action set
// stabilizes after Steps 3–6 (parent plan Review-Log #21).
export type { Spread } from './core/computeSpreads';

// Adapters
export { PdfjsSource } from './adapters/PdfjsSource';
export type { PdfjsSourceOptions } from './adapters/PdfjsSource';

// Worker configuration (advanced usage)
export { configurePdfWorker } from './adapters/configurePdfWorker';

// Zoom (Step 5)
export { SpecialZoomLevel } from './zoom/SpecialZoomLevel';
export type { DefaultScale } from './zoom/types';

// Hook surface (Step 6A — published Step 6G)
export {
  useFlipbook,
  useFlipbookSelector,
  useFlipbookActions,
  shallowEqual,
} from './hooks/useFlipbook';
export type {
  FlipbookHook,
  FlipbookHookBase,
  FlipbookHookState,
  FlipbookHookActions,
  FlipbookHookHelpers,
  FlipbookSnapshot,
} from './hooks/useFlipbook';
