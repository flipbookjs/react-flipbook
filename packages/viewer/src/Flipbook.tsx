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
  /** Optional custom fullscreen target resolver. Receives the viewer's
   *  root element; returns the element to fullscreen, or `null`/`undefined`
   *  to fall back to the root. See `FlipbookProviderProps` for full
   *  semantics. */
  getFullScreenTarget?: (root: HTMLElement) => HTMLElement | null | undefined;
  /** Fired after every fullscreen entry initiated through this viewer's
   *  actions. See `FlipbookProviderProps` for full semantics. */
  onEnterFullScreen?: () => void;
  /** Fired after every fullscreen exit from a committed entry. See
   *  `FlipbookProviderProps` for full semantics. */
  onExitFullScreen?: () => void;

  /** Hard ceiling for streaming print render. Defaults to 100 (Safari iOS quota
   *  empirical floor at printScale=2.0). Pass `Infinity` to opt out (consumer's
   *  responsibility if it crashes their tab). Invalid values (NaN, ≤0,
   *  non-finite) fall back to the default with a dev-warn. */
  printMaxPages?: number;
  /** Per-page rasterization scale. Default 2.0 (≈ 144 DPI). Clamped to
   *  [0.5, 6.0] at the prop-acceptance boundary with a dev-warn on
   *  out-of-range. */
  printScale?: number;
  /** Auto-dismiss timer for the print-error banner (ms). Default 8000.
   *  0 / Infinity / NaN / negative = disable auto-dismiss (consumer dismisses
   *  via click or programmatically via `actions.dismissPrintError()`). */
  printErrorDismissMs?: number;
  /** Fires once per print invocation when the pipeline begins rendering (after
   *  re-entry / zero-page / too-large guards pass). NOT fired for guard
   *  rejections — too-large surfaces via `onPrintError` with `phase: 'too-large'`. */
  onPrintStart?: (info: { totalPages: number; scale: number }) => void;
  /** Fires after `afterprint` cleanup on the successful path. `durationMs`
   *  measured via `performance.now()` (monotonic). */
  onPrintComplete?: (info: { totalPages: number; durationMs: number }) => void;
  /** Fires on any error path — too-large guard, per-page render failure, or
   *  blob-conversion failure. The `phase` discriminator distinguishes which. */
  onPrintError?: (error: Error, info: { phase: 'too-large' | 'render' | 'blob' }) => void;
  /** Fires when an in-flight print is aborted by unmount or source change. */
  onPrintAbort?: (info: { reason: 'unmount' | 'source-change' | 'user-cancel' }) => void;
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
  getFullScreenTarget,
  onEnterFullScreen,
  onExitFullScreen,
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
  printMaxPages,
  printScale,
  printErrorDismissMs,
  onPrintStart,
  onPrintComplete,
  onPrintError,
  onPrintAbort,
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
        enablePageCurl={enablePageCurl}
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
        enablePageCurl={enablePageCurl}
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
      getFullScreenTarget={getFullScreenTarget}
      onEnterFullScreen={onEnterFullScreen}
      onExitFullScreen={onExitFullScreen}
      toolbarTopNode={toolbarTopNode}
      toolbarBottomNode={toolbarBottomNode}
      thumbnailsNode={thumbnailsNode}
      printMaxPages={printMaxPages}
      printScale={printScale}
      printErrorDismissMs={printErrorDismissMs}
      onPrintStart={onPrintStart}
      onPrintComplete={onPrintComplete}
      onPrintError={onPrintError}
      onPrintAbort={onPrintAbort}
    />
  );
}
