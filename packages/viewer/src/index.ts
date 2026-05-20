// Styles — must be imported for Vite to include in the CSS bundle.
// Users import separately: import '@flipbookjs/react-viewer/styles.css'
import './styles/flipbook.css';

// Components
export { Flipbook } from './Flipbook';
export type { FlipbookProps } from './Flipbook';

// PageSource interface
export type {
  PageSource,
  TextItem,
  LinkAnnotation,
  OutlineItem,
} from './types/PageSource';

// Adapters
export { PdfjsSource } from './adapters/PdfjsSource';
export type { PdfjsSourceOptions } from './adapters/PdfjsSource';

// Worker configuration (advanced usage)
export { configurePdfWorker } from './adapters/configurePdfWorker';
