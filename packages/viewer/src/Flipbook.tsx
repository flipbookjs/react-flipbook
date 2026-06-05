'use client';

import { isValidElement, type ReactNode, useMemo, useRef } from 'react';
import type { PageSource } from './types/PageSource';
import type { DefaultScale } from './zoom/types';
import { PdfjsSource } from './adapters/PdfjsSource';
import { FlipbookProvider } from './FlipbookProvider';
import { Toolbar } from './toolbar/Toolbar';
import { ThumbnailPanel } from './thumbnails/ThumbnailPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { VisibilityProps } from './toolbar/resolveToolbarVisibility';

/**
 * Duck-type guard for the slot-object variant of `toolbar`. Distinguishes
 * `{ top?: ReactNode; bottom?: ReactNode }` from a single ReactNode. A
 * React element is technically `typeof === 'object'` but `isValidElement`
 * is true; strings/numbers/arrays of nodes fall through to the single-node
 * branch. The slot object is recognized only when neither true-branch
 * applies AND at least one of `top`/`bottom` is present as a key.
 */
function isSlotObject(value: unknown): value is { top?: ReactNode; bottom?: ReactNode } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !isValidElement(value) &&
    !Array.isArray(value) &&
    ('top' in value || 'bottom' in value)
  );
}

export interface FlipbookProps extends VisibilityProps {
  url?: string;
  source?: PageSource;
  viewMode?: 'single' | 'dual-cover' | 'auto';
  initialPage?: number;
  renderError?: (error: Error) => ReactNode;
  renderLoading?: () => ReactNode;
  /** Enable page-curl animation on pointer/wheel interactions. Defaults to false (opt-in).
   *  Only active when resolvedViewMode === 'dual-cover'. Curl engine lazy-loaded. */
  enablePageCurl?: boolean;
  /** Initial zoom mode or scale. String values map to fit modes; numeric values map
   *  to custom scale (clamped to [0.1, 4] at the factory boundary per architectural
   *  plan Decision 6). Defaults to `'fit-page'`. SpecialZoomLevel enum members
   *  (PageFit, PageWidth, ActualSize) are valid here — their string literal values
   *  match this union by design. Uncontrolled prop: only the INITIAL value is read;
   *  to change zoom at runtime, dispatch via toolbar (Step 6) or remount with a
   *  fresh React key (see Scenario F in architectural plan). */
  defaultScale?: DefaultScale;
  /** Initial theme. Seeds the reducer; runtime changes flow through
   *  `actions.setTheme()` / `actions.toggleTheme()`. Uncontrolled — only the
   *  INITIAL value is read on mount. Default `'light'`. */
  initialTheme?: 'light' | 'dark';
  /** Called on every runtime theme change after `setTheme` / `toggleTheme`.
   *  Not called for the initial seed. The new theme is passed as the
   *  argument. Common use: analytics + persistence. */
  onThemeChange?: (theme: 'light' | 'dark') => void;
  /** Controls the toolbar. Four forms:
   *  - `true | undefined` (default) → built-in `<Toolbar>` renders top + bottom bars
   *  - `false` → no chrome
   *  - `ReactNode` (truthy, non-boolean, not a slot object) → consumer's JSX renders
   *    in the BOTTOM slot only; top slot is null. Use for single-bar custom chrome.
   *  - `{ top?: ReactNode; bottom?: ReactNode }` → consumer's JSX renders in BOTH
   *    slots independently. Either slot may be omitted. Use for two-bar custom chrome
   *    that wants to live in the library's default DOM positions (above/below the
   *    container) without re-implementing the layout.
   *
   *  When a non-boolean form is supplied (single ReactNode OR slot object), the 6
   *  `show*` visibility props + `compact` + `title` are inert — the consumer's JSX
   *  dictates rendering. A dev-mode warning fires when the conflict is detected
   *  (silent in production builds). */
  toolbar?: boolean | ReactNode | { top?: ReactNode; bottom?: ReactNode };
  /** When `true`, suppresses the built-in toolbar's top bar (title +
   *  output buttons). Bottom bar still renders. Ignored when `toolbar` is
   *  a custom ReactNode. */
  compact?: boolean;
  /** Title rendered in the built-in toolbar's top bar. Suppressed when
   *  `compact={true}`. Ignored when `toolbar` is a custom ReactNode. */
  title?: ReactNode;
}

export function Flipbook({
  url,
  source,
  viewMode,
  initialPage = 0,
  renderError,
  renderLoading,
  enablePageCurl = false,
  defaultScale = 'fit-page',
  initialTheme = 'light',
  onThemeChange,
  toolbar = true,
  compact,
  title,
  showPrint,
  showDownload,
  showFullScreen,
  showSelectionMode,
  showZoom,
  showNavigation,
  showThumbnails,
}: FlipbookProps) {
  const internalSource = useMemo(
    () => (url ? new PdfjsSource(url) : null),
    [url],
  );
  const effectiveSource = source ?? internalSource;

  if (!effectiveSource) {
    throw new Error('Flipbook requires either a `url` or `source` prop');
  }

  if (process.env.NODE_ENV !== 'production' && url && source) {
    console.warn(
      'Flipbook: both `url` and `source` provided. `source` takes precedence. Remove one.',
    );
  }

  // Dev-warn when `toolbar` is a non-boolean form (single ReactNode OR slot
  // object) combined with any built-in-only prop. Visibility props + compact
  // + title are inert when the consumer dictates the chrome via custom JSX.
  // Silent in production (NODE_ENV-replaced).
  //
  // Deduplication contract: warn once per CONFLICT WINDOW. The first render
  // that detects a conflict fires the warn; subsequent renders that still see
  // the conflict stay silent (warnedRef stays true). When the consumer
  // resolves the conflict, warnedRef resets — so if the consumer re-introduces
  // the conflict later in the dev session, the warn fires again. Matches
  // iterative dev ergonomics without spamming.
  const warnedRef = useRef(false);
  if (process.env.NODE_ENV !== 'production') {
    const isCustomToolbar = toolbar !== true && toolbar !== false && toolbar != null;
    const hasBuiltInOnlyProps = (
      compact !== undefined ||
      title !== undefined ||
      showPrint !== undefined ||
      showDownload !== undefined ||
      showFullScreen !== undefined ||
      showSelectionMode !== undefined ||
      showZoom !== undefined ||
      showNavigation !== undefined ||
      showThumbnails !== undefined
    );
    if (isCustomToolbar && hasBuiltInOnlyProps) {
      if (!warnedRef.current) {
        console.warn(
          'Flipbook: `toolbar={<JSX/>}` (or slot object) was combined with built-in ' +
          'toolbar props (compact / title / show*). The built-in props are ignored — ' +
          'the custom `toolbar` JSX dictates rendering. Remove the unused props.',
        );
        warnedRef.current = true;
      }
    } else {
      warnedRef.current = false;
    }
  }

  // Toolbar dispatch — compute top + bottom slot nodes.
  // Four discriminated cases:
  //   1) toolbar === false        → both null
  //   2) toolbar === true | null  → built-in <Toolbar> in both slots
  //   3) isSlotObject(toolbar)    → toolbar.top in top slot; toolbar.bottom in bottom
  //   4) otherwise (single node)  → top slot null; toolbar in bottom slot
  let toolbarTopNode: ReactNode | null = null;
  let toolbarBottomNode: ReactNode | null = null;

  if (toolbar === false) {
    // Both null — set above.
  } else if (toolbar === true || toolbar == null) {
    toolbarTopNode = (
      <Toolbar
        position="top"
        compact={compact}
        title={title}
        showPrint={showPrint}
        showDownload={showDownload}
        showFullScreen={showFullScreen}
        showSelectionMode={showSelectionMode}
        showZoom={showZoom}
        showNavigation={showNavigation}
        showThumbnails={showThumbnails}
      />
    );
    toolbarBottomNode = (
      <Toolbar
        position="bottom"
        compact={compact}
        title={title}
        showPrint={showPrint}
        showDownload={showDownload}
        showFullScreen={showFullScreen}
        showSelectionMode={showSelectionMode}
        showZoom={showZoom}
        showNavigation={showNavigation}
        showThumbnails={showThumbnails}
      />
    );
  } else if (isSlotObject(toolbar)) {
    toolbarTopNode = toolbar.top ?? null;
    toolbarBottomNode = toolbar.bottom ?? null;
  } else {
    toolbarBottomNode = toolbar;   // single ReactNode → bottom slot only
  }

  // thumbnailsNode is ALWAYS wired — independent of `showThumbnails`.
  // Button-only semantic (matching other `show*` props): `showThumbnails={false}`
  // hides the bottom-bar TOGGLE BUTTON; the panel slot is always present so
  // custom UI can open the panel via `actions.toggleThumbnails()`. The panel
  // itself reads `state.thumbnailsOpen` and renders empty when closed
  // (slide-animation contract — outer shell stays mounted).
  //
  // Isolate the panel inside its own ErrorBoundary so a thumbnail-side
  // failure (e.g., `source.getPageSize(idx)` throwing on a malformed page,
  // an IntersectionObserver edge case, a renderPage promise rejecting in
  // a way the panel's catch doesn't anticipate) cannot crash the entire
  // `<Flipbook>` tree and take the main reading surface down with it.
  // `fallback={() => null}` means a crashed panel silently disappears —
  // toolbar + document remain functional. The function form is required:
  // `ErrorBoundary`'s `fallback` prop is typed `(error: Error) => ReactNode`.
  const thumbnailsNode: ReactNode = (
    <ErrorBoundary fallback={() => null}>
      <ThumbnailPanel />
    </ErrorBoundary>
  );

  return (
    <FlipbookProvider
      source={effectiveSource}
      viewMode={viewMode}
      initialPage={initialPage}
      renderError={renderError}
      renderLoading={renderLoading}
      enablePageCurl={enablePageCurl}
      defaultScale={defaultScale}
      initialTheme={initialTheme}
      onThemeChange={onThemeChange}
      toolbarTopNode={toolbarTopNode}
      toolbarBottomNode={toolbarBottomNode}
      thumbnailsNode={thumbnailsNode}
    />
  );
}
