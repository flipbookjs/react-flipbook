import { useContext, useMemo } from 'react';
import { useSyncExternalStoreWithSelector } from './useSyncExternalStoreWithSelector';
import { FlipbookStoreContext } from '../core/FlipbookStoreContext';
import type { PageSource } from '../types/PageSource';
import type { DefaultScale } from '../zoom/types';

export { shallowEqual } from './shallowEqual';

// ============================================================
// Public type surface
// ============================================================

/** The always-defined view fields. Status/error live at the TOP LEVEL of
 *  FlipbookHook so TypeScript's control-flow narrowing on `fb.status === 'ready'`
 *  propagates correctly to `fb.source`. See Decision 1 of the parent plan for
 *  the rationale. */
export interface FlipbookHookState {
  pageNumber: number;
  totalPages: number;
  spreadIndex: number;
  spreadCount: number;
  viewMode: 'single' | 'dual-cover' | 'auto';
  resolvedViewMode: 'single' | 'dual-cover';
  zoomMode: 'fit-page' | 'fit-width' | 'custom';
  customScale: number;
  effectiveScale: number;
  isOverflowing: boolean;
  isFullScreen: boolean;
  theme: 'light' | 'dark';
  interactionMode: 'select' | 'pan';
  isPrinting: boolean;
  printError:
    | { type: 'too-large'; totalPages: number; limit: number }
    | { type: 'render-failed'; pageIndex: number; message: string }
    | { type: 'blob-conversion-failed'; pageIndex: number; canvasWidth: number; canvasHeight: number }
    | null;
  thumbnailsOpen: boolean;
}

export interface FlipbookHookActions {
  next: () => void;
  previous: () => void;
  goToPage: (pageNumber: number) => void;
  goToFirst: () => void;
  goToLast: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (scale: DefaultScale) => void;
  fitPage: () => void;
  fitWidth: () => void;
  enterFullScreen: () => Promise<void>;
  exitFullScreen: () => Promise<void>;
  toggleFullScreen: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setInteractionMode: (mode: 'select' | 'pan') => void;
  print: () => Promise<void>;
  download: () => void;
  setThumbnailsOpen: (open: boolean) => void;
  toggleThumbnails: () => void;
  dismissPrintError: () => void;
  /**
   * User-initiated cancel of an in-flight print job. Provides an escape from
   * the `isPrinting=true` state when `afterprint` never fires — see KL12 (dialog
   * left open indefinitely) and KL23 (Android WebView / WKWebView). Tears down
   * the print sheet, revokes blob URLs, aborts in-flight `renderPage`/`decode`,
   * and resets `isPrinting` to `false`. Fires `onPrintAbort({ reason:
   * 'user-cancel' })`. No-op if no print is in flight.
   */
  cancelPrint: () => void;
}

export interface FlipbookHookHelpers {
  /** True when a downloadable URL is available. Always false in 6A; 6F enables
   *  via `source.getSourceUrl?()`. */
  canDownload: boolean;
  /** True if browser exposes the Fullscreen API. Detected once at mount via
   *  `document.fullscreenEnabled` (with SSR-safe `typeof document` guard).
   *  Reads the STANDARD (non-prefixed) property only — older Safari (<15)
   *  exposed `document.webkitFullscreenEnabled` instead. On those browsers
   *  the standard property is `undefined` (coerces to `false`), so consumers
   *  see no fullscreen UI — graceful degradation matching the iframe-without-
   *  `allowfullscreen` case. The viewer's `react@>=18.0.0` peerDep targets
   *  Safari 14+ / Chrome 87+ / Firefox 78+, all of which expose the standard
   *  property. Vendor-prefix support (if needed) belongs in 6E alongside the
   *  real `requestFullscreen()` call.
   *
   *  ⚠️ Server-side render returns `false` (no `document`); first client
   *  render also returns `false` (matches server via `getServerSnapshot`).
   *  After hydration, the value switches to the actual browser capability —
   *  on most desktop browsers this is `true`. Consumers rendering UI
   *  conditional on `canFullScreen` (`{fb.helpers.canFullScreen &&
   *  <FullscreenButton />}`) will see a post-hydration flicker as the button
   *  appears. Mitigations: (a) accept the flicker — it's brief and harmless
   *  for fullscreen UI; (b) defer the conditional render to a client-only
   *  effect (`const [mounted, setMounted] = useState(false); useEffect(()
   *  => setMounted(true), []); return mounted && fb.helpers.canFullScreen
   *  ? ... : null;`). */
  canFullScreen: boolean;
  /** Map a 1-indexed pageNumber to the 0-indexed spread index containing it
   *  under the current resolvedViewMode. Returns -1 for: pageNumber not a
   *  positive integer, pageNumber > totalPages, or status !== 'ready'. */
  pageToSpreadIndex: (pageNumber: number) => number;
}

/** Base type carrying the always-present fields. The discriminated union
 *  ANDs this with the variant-specific status/error/source triple. */
export interface FlipbookHookBase {
  state: FlipbookHookState;
  actions: FlipbookHookActions;
  helpers: FlipbookHookHelpers;
}

/** The discriminated-union return shape of `useFlipbook()`. Three branches:
 *  - status: 'ready'    → source: PageSource, error: null    (canonical "viewer ready" branch)
 *  - status: 'loading'  → source: null,       error: null    (no error yet)
 *  - status: 'error'    → source: null,       error: Error   (error is GUARANTEED non-null)
 *
 *  The loading and error branches are SEPARATE (not merged into `'loading' |
 *  'error'`) so TypeScript can narrow `error` precisely in each:
 *  ```
 *    const fb = useFlipbook();
 *    if (fb.status !== 'ready') return null;
 *    // Here fb.source is narrowed to PageSource (not null).
 *    fb.source.renderPage(0, 1);  // typechecks.
 *
 *    // ... or in an error-display component:
 *    if (fb.status === 'error') {
 *      console.error(fb.error.message);  // ← no `?.` needed; error is Error, not Error | null
 *    }
 *  ```
 *
 *  ⚠️ TypeScript discriminated unions narrow via PROPERTY ACCESS, not via
 *  destructured variables. The destructuring form below does NOT narrow:
 *  ```
 *    // ❌ Does NOT typecheck:
 *    const { status, source } = useFlipbook();
 *    if (status === 'ready') {
 *      source.getPageCount();  // Error: 'source' is possibly 'null'
 *    }
 *  ```
 *  Once you destructure `status` and `source` into separate variables, TS
 *  loses the connection between them. Keep the property-access form
 *  (`fb.status` / `fb.source`) when narrowing, or destructure AFTER the
 *  type guard (`const fb = useFlipbook(); if (fb.status === 'ready') {
 *  const { source } = fb; source.getPageCount(); }`).
 *
 *  ⚠️ State fields (`fb.state.totalPages`, `fb.state.pageNumber`, etc.)
 *  reflect the LAST KNOWN reducer state. During a source transition
 *  (consumer changes the `source` prop), `fb.status` becomes `'loading'`
 *  but `fb.state.*` still reflects the PREVIOUS source until the next
 *  SOURCE_CHANGED commit. Guard source-derived state reads on
 *  `fb.status === 'ready'`:
 *  ```
 *    <span>{fb.status === 'ready' ? fb.state.totalPages : '—'} pages</span>
 *  ```
 *
 *  ⚠️ The `source` prop on `<FlipbookProvider>` must be STABLE across
 *  renders. An inline expression like `<FlipbookProvider source={new
 *  PdfjsSource(url)}>` creates a new source on every render → restarts
 *  `init()` → 'loading' forever. Memoize:
 *  ```
 *    const source = useMemo(() => new PdfjsSource(url), [url]);
 *    return <FlipbookProvider source={source}>...</FlipbookProvider>;
 *  ```
 *
 *  This is the load-bearing claim of Decision 1: top-level discriminator
 *  enables TypeScript control-flow narrowing on `fb.status`.
 */
export type FlipbookHook = FlipbookHookBase & (
  | { status: 'ready';    error: null;   source: PageSource }
  | { status: 'loading';  error: null;   source: null }
  | { status: 'error';    error: Error;  source: null }
);

/** Snapshot consumed by `useFlipbookSelector`. NOT a discriminated union —
 *  selector consumers who want narrowing must guard explicitly. Includes
 *  `actions` and `helpers` so they can be subscribed-to via the same
 *  mechanism (used by `useFlipbookActions`). */
export interface FlipbookSnapshot {
  status: 'loading' | 'ready' | 'error';
  error: Error | null;
  source: PageSource | null;
  state: FlipbookHookState;
  actions: FlipbookHookActions;
  helpers: FlipbookHookHelpers;
}

// ============================================================
// SSR sentinel constants — module-level frozen
// ============================================================

/** Loading-state hook state. Used by SSR_HOOK and SSR_SNAPSHOT (the SSR pass,
 *  where there's no live reducer yet). Live-loading (provider mounted, source
 *  loading client-side) uses the LIVE snapshot's state (which carries the
 *  user's initialTheme) — see useFlipbook() impl below. */
export const SSR_STATE: FlipbookHookState = Object.freeze({
  pageNumber: 1, totalPages: 0, spreadIndex: 0, spreadCount: 0,
  viewMode: 'auto', resolvedViewMode: 'single',
  zoomMode: 'fit-page', customScale: 1, effectiveScale: 1, isOverflowing: false,
  isFullScreen: false, theme: 'light', interactionMode: 'select', isPrinting: false,
  printError: null,
  thumbnailsOpen: false,
}) as FlipbookHookState;

/** No-op action object — used by SSR_HOOK and SSR_SNAPSHOT. Frozen; identity
 *  stable across all SSR-path returns. */
export const SSR_ACTIONS: FlipbookHookActions = Object.freeze({
  next: () => {}, previous: () => {}, goToPage: () => {}, goToFirst: () => {}, goToLast: () => {},
  zoomIn: () => {}, zoomOut: () => {}, setZoom: () => {}, fitPage: () => {}, fitWidth: () => {},
  enterFullScreen: () => Promise.resolve(),
  exitFullScreen: () => Promise.resolve(),
  toggleFullScreen: () => Promise.resolve(),
  setTheme: () => {}, toggleTheme: () => {},
  setInteractionMode: () => {},
  print: () => Promise.resolve(),
  download: () => {},
  setThumbnailsOpen: () => {},
  toggleThumbnails: () => {},
  dismissPrintError: () => {},
  cancelPrint: () => {},
}) as FlipbookHookActions;

/** Default helpers — all-false / always-(-1) — used by SSR_HOOK and SSR_SNAPSHOT. */
export const SSR_HELPERS: FlipbookHookHelpers = Object.freeze({
  canDownload: false, canFullScreen: false, pageToSpreadIndex: () => -1,
}) as FlipbookHookHelpers;

/** The SSR sentinel returned by `useFlipbook()` ONLY when the snapshot IS the
 *  `SSR_SNAPSHOT` identity (i.e., the server-render pass via
 *  `getServerSnapshot`). NOT returned during client-side live-loading — see
 *  useFlipbook() impl: live-loading builds a fresh per-snapshot result so the
 *  user's initialTheme (in the live snapshot's state) is preserved. */
export const SSR_HOOK: FlipbookHook = Object.freeze({
  status: 'loading',
  error: null,
  source: null,
  state: SSR_STATE,
  actions: SSR_ACTIONS,
  helpers: SSR_HELPERS,
}) as FlipbookHook;

/** Snapshot returned by `getServerSnapshot` (SSR) and consumed by
 *  `useFlipbookSelector`. Same six fields as the runtime snapshot. Module-level
 *  frozen identity — `useFlipbook()` uses `snapshot === SSR_SNAPSHOT` as the
 *  signal to return the SSR_HOOK sentinel (vs building a fresh live-loading
 *  result). */
export const SSR_SNAPSHOT: FlipbookSnapshot = Object.freeze({
  status: 'loading',
  error: null,
  source: null,
  state: SSR_STATE,
  actions: SSR_ACTIONS,
  helpers: SSR_HELPERS,
}) as FlipbookSnapshot;

// ============================================================
// Hooks
// ============================================================

/**
 * Selector hook backed by `useSyncExternalStoreWithSelector`. Re-renders the
 * calling component ONLY when `isEqual(prevSelected, nextSelected)` returns
 * false (default Object.is). Pass `shallowEqual` for object-literal selections.
 *
 * SSR-safe via the provider's `getServerSnapshot` (returns SSR_SNAPSHOT).
 *
 * Throws if used outside FlipbookProvider.
 */
export function useFlipbookSelector<T>(
  selector: (snapshot: FlipbookSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useContext(FlipbookStoreContext);
  if (store === null) throw new Error('useFlipbookSelector must be used within FlipbookProvider');
  return useSyncExternalStoreWithSelector(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
    selector,
    isEqual,
  );
}

/**
 * Returns the stable FlipbookHookActions object. Re-renders the calling
 * component ONLY when the actions object identity rotates — which happens
 * only when source rotates (per the per-action useCallback dep contract;
 * print/download close over source). Cheaper than `useFlipbook()` for
 * dispatch-only consumers (PrevButton, NextButton, etc.).
 *
 * SSR-safe — returns SSR_ACTIONS server-side.
 *
 * Throws if used outside FlipbookProvider.
 */
export function useFlipbookActions(): FlipbookHookActions {
  return useFlipbookSelector((s) => s.actions, Object.is);
}

/**
 * Convenience hook — returns the full FlipbookHook with the discriminated-
 * union shape. Re-renders on every dispatch (because it selects the entire
 * snapshot). Use this for top-level toolbars + ad-hoc consumers; for perf-
 * critical components (continuous-zoom readouts), use `useFlipbookSelector`
 * with a narrow selector.
 *
 * Returns SSR_HOOK ONLY when the snapshot IS SSR_SNAPSHOT (true server-side
 * pass). During client-side live-loading (provider mounted, source loading),
 * returns a fresh per-snapshot result built from the live snapshot's state —
 * this preserves the consumer's `initialTheme` and other reducer-seeded fields
 * that a frozen sentinel would erase.
 *
 * Result identity is stable per snapshot (`useMemo([snapshot])`), so two
 * consecutive renders with the same snapshot return the same object — React.memo
 * on consumer components skips correctly.
 *
 * Throws if used outside FlipbookProvider.
 */
export function useFlipbook(): FlipbookHook {
  const snapshot = useFlipbookSelector((s) => s);
  return useMemo<FlipbookHook>(() => {
    // True SSR pass — return the frozen sentinel.
    if (snapshot === SSR_SNAPSHOT) return SSR_HOOK;
    // 'error' — the snapshot type is `error: Error | null` (the looser shape
    // for selector consumers); the hook's union encodes the tighter invariant
    // `error: Error` for the error branch. We narrow via `as Error` cast
    // (Rule 3: trust validated internal data). The provider guarantees
    // sourceStatus and sourceError are set together — see Phase 3.2's
    // narrowing logic. If a future refactor breaks this invariant, the bug
    // surfaces at the first consumer that calls `fb.error.message`; that's
    // the right place to fix it.
    if (snapshot.status === 'error') {
      return {
        status: 'error',
        error: snapshot.error as Error,
        source: null,
        state: snapshot.state,
        actions: snapshot.actions,
        helpers: snapshot.helpers,
      };
    }
    // 'loading' — client-side live loading. Build from the live snapshot so
    // user-seeded state (initialTheme etc.) is preserved.
    if (snapshot.status === 'loading') {
      return {
        status: 'loading',
        error: null,
        source: null,
        state: snapshot.state,
        actions: snapshot.actions,
        helpers: snapshot.helpers,
      };
    }
    // 'ready' — same `as` cast pattern as the error branch. Provider invariant:
    // sourceStatus === 'ready' ⇒ source !== null (Phase 3.2).
    return {
      status: 'ready',
      error: null,
      source: snapshot.source as PageSource,
      state: snapshot.state,
      actions: snapshot.actions,
      helpers: snapshot.helpers,
    };
  }, [snapshot]);
}
