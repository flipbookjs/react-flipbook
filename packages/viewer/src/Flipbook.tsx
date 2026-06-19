'use client';

import { isValidElement, type ReactNode, useMemo } from 'react';
import type { PageSource } from './types/PageSource';
import type { DefaultScale } from './zoom/types';
import { PdfjsSource } from './adapters/PdfjsSource';
import { FlipbookProvider } from './FlipbookProvider';
import { Toolbar } from './toolbar/Toolbar';
import { ThumbnailPanel } from './thumbnails/ThumbnailPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { EdgeArrows } from './components/EdgeArrows';
import { devWarn } from './core/devWarn';
import type { VisibilityProps } from './toolbar/resolveToolbarVisibility';

// Module-level once-per-app guard for the single-ReactNode toolbar
// position-change deprecation warn (added in 1.0.0 when the default
// flipped from BOTTOM in the 0.1.0-alpha.1 cut to TOP). Lives at module scope so re-renders
// + multi-instance apps don't double-warn. Reset by HMR / full page
// reload. Production stays cost-free: the entire guarded block is gated
// on `process.env.NODE_ENV !== 'production'` at the call site below, so
// bundlers DCE the Set.has / Set.add calls along with `devWarn`.
const warnedDeprecations = new Set<string>();

// Module-level dedup for the 2.0 both-supplied (thumbnailDensity +
// thumbnailWidth) warn. Same once-per-process pattern as
// `warnedDeprecations`. Declared at MODULE SCOPE (NOT inside the Flipbook
// function body) so the flag survives across renders; declared inside the
// component it would reset every call and the warn would fire once per
// render instead of once per process.
const warnedFlipbookBothSupplied = { triggered: false };
function warnOnceFlipbookBothSupplied(): void {
  if (process.env.NODE_ENV === 'production') return;
  if (warnedFlipbookBothSupplied.triggered) return;
  warnedFlipbookBothSupplied.triggered = true;
  devWarn(
    `Flipbook: both thumbnailDensity and thumbnailWidth are supplied; thumbnailWidth wins. Drop one to silence this warning.`,
  );
}

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

// Common to both variants. Every field that was on the 0.1.0-alpha.1 `FlipbookProps`
// (other than the toolbar-variant-specific `toolbar`, `compact`, `title`) lives
// here unchanged with its existing JSDoc. The thumbnail sizing surface is
// declared separately on `FlipbookSizingProps` (below), which `FlipbookProps`
// composes with via intersection so the discriminated union prevents
// supplying both density and width at the type level.
interface FlipbookCommonProps {
  url?: string;
  source?: PageSource;
  viewMode?: 'single' | 'dual-cover' | 'auto';
  initialPage?: number;
  renderError?: (error: Error) => ReactNode;
  renderLoading?: () => ReactNode;
  /** Enable page-curl animation on pointer/wheel interactions. Defaults to false (opt-in).
   *  Only active when resolvedViewMode === 'dual-cover'. Curl engine lazy-loaded.
   *
   *  Document-behavior prop — available on BOTH built-in and custom toolbar variants
   *  (declared on FlipbookCommonProps, NOT only on VisibilityProps). The toolbar's
   *  selection-mode button reads it for curl-aware disabled state; the document's
   *  curl-engine reads it for chunk preload + dual-cover gesture handling. Both
   *  concerns are independent of toolbar variant. */
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
  /** Semantic document name — used as the download filename (sanitized).
   *  Distinct from `title` (which is display-only and may be ReactNode):
   *  display and semantic identity are independent concerns. When omitted,
   *  the download filename falls back to the URL's pathname basename, then
   *  to `'document'`. Consumers wanting "toolbar title is also the filename"
   *  should pass both `title` and `documentName` set to the same string. */
  documentName?: string;
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

  // ---- NEW in 1.0.0 ----

  /** Initial interaction mode. `'pan'` for hand-drag panning, `'select'` for
   *  text selection (default). Uncontrolled — to change at runtime, dispatch
   *  `actions.setInteractionMode()`. Mirrors the `initialTheme` pattern. */
  initialInteractionMode?: 'select' | 'pan';
  /** Show the edge-tap navigation arrows that overlay on the left and right
   *  edges of the viewer (vertically centered; fade in on hover; always
   *  visible on touch). Defaults to `true` since most paginated viewers
   *  expose these as a primary affordance. Set `false` to opt out (e.g.,
   *  when the consumer provides their own navigation UI alongside a
   *  custom toolbar). Independent of toolbar variant — available on both
   *  the built-in and custom toolbar surfaces. Keyboard navigation
   *  (←/→ arrow keys) is unaffected by this prop. */
  showEdgeArrows?: boolean;
  /** Optional children mounted inside the provider context, alongside the
   *  viewer chrome. Use this to mount effect-host components that call
   *  `useFlipbook` / `useFlipbookActions` / `useFlipbookSelector` from
   *  inside provider scope — those hooks throw outside provider context, so
   *  external-state sync patterns (e.g., a `<ThemeSyncer>` that mirrors an
   *  app-level theme store into the viewer) require a child mounted via
   *  this prop. See MIGRATION.md §7.2 / §9.2 for the canonical patterns. */
  children?: ReactNode;
}

/** Slot-object shape for `toolbar`. At least one of `top` / `bottom` must be
 *  supplied — the empty-object form `toolbar={{}}` is rejected at compile time
 *  because it has no rendering effect and would silently fall through to the
 *  single-ReactNode branch at runtime. */
type ToolbarSlots =
  | { top: ReactNode; bottom?: ReactNode }
  | { top?: ReactNode; bottom: ReactNode };

/** Built-in toolbar variant: `show*` + `compact` + `title` are meaningful.
 *  `null` is included alongside `boolean` because the runtime treats
 *  `toolbar == null` as built-in (Flipbook.tsx slot-dispatch case 2). */
interface FlipbookBuiltinToolbarProps extends FlipbookCommonProps, VisibilityProps {
  /** Controls the toolbar. Three forms (built-in variant):
   *  - `true | undefined` (default) → built-in `<Toolbar>` renders top + bottom bars
   *  - `null` → treated as undefined at runtime; built-in toolbar renders
   *  - `false` → no chrome
   *
   *  For consumer-supplied JSX (single ReactNode or slot object), use the
   *  `FlipbookCustomToolbarProps` variant (declared below). The TypeScript
   *  discriminator routes the call to that variant when `toolbar` is anything
   *  other than `boolean | null | undefined`. */
  toolbar?: boolean | null;
  /** When `true`, suppresses the built-in toolbar's top bar (title +
   *  output buttons). Bottom bar still renders. */
  compact?: boolean;
  /** Title rendered in the built-in toolbar's top bar. Suppressed when
   *  `compact={true}`. */
  title?: ReactNode;
}

/** Custom toolbar variant: a non-null, non-boolean `ReactNode` OR a slot
 *  object. The `show*` / `compact` / `title` props are forbidden here at
 *  compile time — they're inert with custom chrome and combining them was
 *  a known dev-time footgun in the 0.1.0-alpha.1 pre-release.
 *
 *  `enablePageCurl` is NOT marked `never` — it controls document curl-engine
 *  behavior (lazy chunk preload, dual-cover gesture handling), independent
 *  of toolbar variant. Custom-toolbar consumers may still want curl behavior. */
interface FlipbookCustomToolbarProps extends FlipbookCommonProps {
  /** Custom toolbar JSX. Three forms:
   *  - **Single `ReactNode`** → renders in the **TOP slot** (bottom slot is null).
   *    Changed in 1.0.0 from BOTTOM-only (the 0.1.0-alpha.1 behavior). A dev-mode warning fires
   *    once per app to flag the position change; use the explicit slot form
   *    below to opt into the bottom slot deterministically. (Production
   *    builds are silent — the warn is DCE-stripped.)
   *  - **`{ top: ReactNode; bottom?: ReactNode }`** → top + optional bottom slot.
   *  - **`{ top?: ReactNode; bottom: ReactNode }`** → optional top + bottom slot.
   *
   *  At least one of `top` / `bottom` must be supplied — `toolbar={{}}` is
   *  rejected at compile time because it would silently fall through to the
   *  single-ReactNode branch (where `{}` would render as an invalid React child). */
  toolbar:
    | Exclude<ReactNode, boolean | null | undefined>
    | ToolbarSlots;
  showZoom?: never;
  showNavigation?: never;
  showThumbnails?: never;
  showFullScreen?: never;
  showSelectionMode?: never;
  showPrint?: never;
  showDownload?: never;
  compact?: never;
  title?: never;
  // `enablePageCurl` deliberately NOT in the `never` block — see the
  // interface JSDoc above for the document-behavior rationale.
}

/** Discriminated union enforcing single-supply of the 2.0 sizing surface
 *  at the type level. Callers using the public types can't supply BOTH
 *  `thumbnailDensity` AND `thumbnailWidth` without a TypeScript error.
 *
 *  - `thumbnailDensity?: 'compact' | 'comfortable' | 'spacious'` — relative,
 *    container-adaptive. Default `'comfortable'` (5 median-width thumbnails
 *    fit across the panel's content width plus their inter-thumb gaps).
 *  - `thumbnailWidth?: number` — absolute pixel width. Clamped to
 *    [80, 2048] at the prop boundary with a dev-warn for values above the
 *    ceiling. Width is forwarded directly to every thumbnail; container
 *    resize doesn't change it.
 *
 *  When both somehow arrive at runtime (JS-side bypass via `as any` or an
 *  untyped caller), the panel uses `thumbnailWidth` and emits a one-shot
 *  dev-warn. The composable `<ThumbnailPanel>` surface uses unprefixed
 *  prop names (`density` / `width`) — see `ThumbnailPanelProps`.
 *
 *  Same resolution semantics on both surfaces; the prop-name difference
 *  is API-surface-only. See `MIGRATION-v2.md` for the 1.x `thumbnailSize`
 *  → 2.0 migration table. */
type FlipbookSizingProps =
  | { thumbnailDensity?: 'compact' | 'comfortable' | 'spacious'; thumbnailWidth?: never }
  | { thumbnailDensity?: never; thumbnailWidth: number };

/** Cross-product of (toolbar variant) × (sizing variant). Equivalent to
 *  the explicit four-cell union (BuiltinDensity | BuiltinWidth |
 *  CustomDensity | CustomWidth) but expressed as an intersection so the
 *  existing toolbar discriminated union is preserved verbatim. */
export type FlipbookProps =
  (FlipbookBuiltinToolbarProps | FlipbookCustomToolbarProps) & FlipbookSizingProps;

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
  initialInteractionMode = 'select',
  onThemeChange,
  getFullScreenTarget,
  onEnterFullScreen,
  onExitFullScreen,
  toolbar = true,
  compact,
  title,
  documentName,
  thumbnailDensity,
  thumbnailWidth,
  children,
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
  showEdgeArrows = true,
}: FlipbookProps) {
  // Both-supplied dev-warn (Flipbook surface). TypeScript prevents this
  // for typed callers; JS-side bypass triggers the once-per-process warn.
  // Precedence (forwarded below): width wins.
  if (thumbnailDensity !== undefined && thumbnailWidth !== undefined) {
    warnOnceFlipbookBothSupplied();
  }

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

  // Toolbar dispatch — compute top + bottom slot nodes.
  // Four discriminated cases:
  //   1) toolbar === false        → both null
  //   2) toolbar === true | null  → built-in <Toolbar> in both slots
  //   3) isSlotObject(toolbar)    → toolbar.top in top slot; toolbar.bottom in bottom
  //   4) otherwise (single node)  → top slot only; bottom slot null
  //                                 (changed from BOTTOM in 1.0.0 — see MIGRATION.md §6.2)
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
    toolbarTopNode = toolbar;   // single ReactNode → top slot (changed in 1.0.0)
    // Single-app deprecation warn for the position change. The whole `if` block
    // is statically removed in production builds via the NODE_ENV replacement
    // (Vite / Webpack / esbuild all do this), so Set.has + Set.add disappear
    // alongside the devWarn call.
    if (process.env.NODE_ENV !== 'production') {
      const key = 'flipbook-single-toolbar';
      if (!warnedDeprecations.has(key)) {
        warnedDeprecations.add(key);
        devWarn(
          '[flipbook] Single ReactNode toolbar position changed in 1.0.0: '
          + 'now renders in the TOP slot (was BOTTOM in 0.1.0-alpha.1). Use '
          + '`toolbar={{ bottom: <X/> }}` to target the bottom slot explicitly. '
          + 'This warning persists through at least 1.0.1; removal trigger is '
          + 'consumer validation.',
        );
      }
    }
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
  //
  // Forwarding: the panel's discriminated union takes EITHER `{ width: number }`
  // OR `{ density?: Density }`, never both. Precedence rule (matches the
  // both-supplied dev-warn above): explicit `thumbnailWidth` wins over
  // `thumbnailDensity`. `as const` keeps the TypeScript narrowing precise
  // so the spread satisfies the panel's discriminated union (without
  // `as const`, both branches widen to `{ width?: number; density?: ... }`
  // which fails the union check).
  const panelSizingProps = thumbnailWidth !== undefined
    ? ({ width: thumbnailWidth } as const)
    : ({ density: thumbnailDensity } as const);
  const thumbnailsNode: ReactNode = (
    <ErrorBoundary fallback={() => null}>
      <ThumbnailPanel {...panelSizingProps} />
    </ErrorBoundary>
  );

  // EdgeArrows is rendered inside the stage by the provider. Wrapping in
  // ErrorBoundary keeps a malformed selector / actions hook crash from
  // taking down the whole viewer chrome — the arrows just disappear.
  const edgeArrowsNode: ReactNode = showEdgeArrows ? (
    <ErrorBoundary fallback={() => null}>
      <EdgeArrows />
    </ErrorBoundary>
  ) : null;

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
      initialInteractionMode={initialInteractionMode}
      onThemeChange={onThemeChange}
      getFullScreenTarget={getFullScreenTarget}
      onEnterFullScreen={onEnterFullScreen}
      onExitFullScreen={onExitFullScreen}
      toolbarTopNode={toolbarTopNode}
      toolbarBottomNode={toolbarBottomNode}
      thumbnailsNode={thumbnailsNode}
      edgeArrowsNode={edgeArrowsNode}
      printMaxPages={printMaxPages}
      printScale={printScale}
      printErrorDismissMs={printErrorDismissMs}
      onPrintStart={onPrintStart}
      onPrintComplete={onPrintComplete}
      onPrintError={onPrintError}
      onPrintAbort={onPrintAbort}
      documentName={documentName}
    >
      {children}
    </FlipbookProvider>
  );
}
