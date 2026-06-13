// Side-effect import: include flipbook.css (which itself imports theme.css and
// toolbar.css) so consumers using ONLY the sub-path get the full CSS bundle.
// Vite library mode dedupes side-effect imports across entries, so consumers
// using both the main entry AND the sub-path don't double-load.
import '../styles/flipbook.css';

// Container + registration.
export { ToolbarShell } from './ToolbarShell';
export { useToolbarPart } from './useToolbarPart';
export { ToolbarShellContext } from './ToolbarShellContext';
export type { FocusableElement, ToolbarShellContextValue } from './ToolbarShellContext';
export type { UseToolbarPartReturn } from './useToolbarPart';

// Buttons (10).
export { PrevButton } from './buttons/PrevButton';
export { NextButton } from './buttons/NextButton';
export { ZoomInButton } from './buttons/ZoomInButton';
export { ZoomOutButton } from './buttons/ZoomOutButton';
export { FullScreenButton } from './buttons/FullScreenButton';
export { PrintButton } from './buttons/PrintButton';
export { DownloadButton } from './buttons/DownloadButton';
export { SelectionModeButton } from './buttons/SelectionModeButton';
export { ThemeToggleButton } from './buttons/ThemeToggleButton';
export { ThumbnailsToggleButton } from './buttons/ThumbnailsToggleButton';

// Readouts (2).
export { PageReadout } from './readouts/PageReadout';
export { ZoomReadout } from './readouts/ZoomReadout';

// Labels (read-only — consumers introspect; a future 1.x minor will add an override surface).
export { LABELS } from './labels';

// Built-in wrapper (Step 6C).
export { Toolbar } from './Toolbar';
export type { ToolbarProps } from './Toolbar';

// Thumbnail panel (Step 6D — also available via main entry).
export { ThumbnailPanel } from '../thumbnails/ThumbnailPanel';
