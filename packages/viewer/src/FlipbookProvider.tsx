import {
  useReducer,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import { useWheelRouter } from './zoom/useWheelRouter';
import type { PageSource } from './types/PageSource';
import { usePageSource } from './hooks/usePageSource';
import { flipbookReducer, createInitialState } from './core/flipbookReducer';
import { computeSpreads } from './core/computeSpreads';
import { LoadingState } from './components/LoadingState';
import { FlipbookContext } from './core/FlipbookContext';
import { SpreadRenderer } from './components/SpreadRenderer';
import { AriaAnnouncer } from './components/AriaAnnouncer';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  PageRegistryWriteContext,
  PageRegistryReadContext,
  createPageRegistry,
} from './core/PageRegistry';
import { CurlChunkErrorBoundary } from './curl/CurlChunkErrorBoundary';
import { deriveEffectiveScaleAndOverflow } from './zoom/derivation';
import type { DefaultScale } from './zoom/types';
import { FlipbookStoreContext } from './core/FlipbookStoreContext';
import {
  SSR_SNAPSHOT,
  type FlipbookHookActions,
  type FlipbookHookHelpers,
  type FlipbookHookState,
  type FlipbookSnapshot,
} from './hooks/useFlipbook';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useIsomorphicLayoutEffect } from './hooks/useIsomorphicLayoutEffect';
import { devWarn } from './core/devWarn';
import { increase, decrease } from './zoom/zoomingLevel';
import { SpecialZoomLevel } from './zoom/SpecialZoomLevel';
import { pageToSpreadIndex as findSpreadByPageIndex } from './core/computeSpreads';

/**
 * Curl engine is delivered as a separate chunk loaded only when `enablePageCurl === true`.
 * Wrapped in CurlChunkErrorBoundary so chunk-load failures silently disable curl
 * without affecting the base viewer.
 */
const LazyCurlOverlay = lazy(() => import('./curl/CurlOverlay'));

interface FlipbookProviderProps {
  source: PageSource;
  viewMode?: 'single' | 'dual-cover' | 'auto';
  initialPage?: number;
  renderError?: (error: Error) => ReactNode;
  renderLoading?: () => ReactNode;
  /** Enable page-curl animation on pointer/wheel interactions. Defaults to false (opt-in).
   *  Curl engine is lazy-loaded as a separate chunk only when this is true. Only active
   *  when `resolvedViewMode === 'dual-cover'`. */
  enablePageCurl?: boolean;
  /** Initial zoom mode or scale. Wired to 5A's `createInitialState(viewMode, defaultScale)`
   *  factory parameter. Defaults to `'fit-page'`. */
  defaultScale?: DefaultScale;
  /** Seed the reducer's initial `theme` field. Default 'light'. Read once at
   *  mount; subsequent prop changes are ignored (matches `defaultScale`'s
   *  uncontrolled semantics). 6C surfaces this as a `<Flipbook>` prop. */
  initialTheme?: 'light' | 'dark';
  /** Called on every runtime theme change after `setTheme` / `toggleTheme`
   *  dispatches. NOT called when the reducer is seeded with `initialTheme`
   *  on mount — `onThemeChange` is for runtime transitions only. The new
   *  theme is passed as the argument; reading `useFlipbook().state.theme`
   *  inside the callback would see the OLD value because React hasn't
   *  committed yet. Ref-mirrored so inline arrow-function consumers see
   *  the latest callback identity on every dispatch. */
  onThemeChange?: (theme: 'light' | 'dark') => void;
  /** Top-bar node rendered above the container inside `.fbjs-root`. Computed
   *  by `<Flipbook>` from the `toolbar` prop dispatch. Pass `null` to omit. */
  toolbarTopNode?: ReactNode | null;
  /** Bottom-bar node rendered below the container inside `.fbjs-root`. */
  toolbarBottomNode?: ReactNode | null;
  /** Thumbnail panel node rendered between `.fbjs-container` and the
   *  bottom toolbar inside `.fbjs-root`. Computed by `<Flipbook>` —
   *  always `<ThumbnailPanel />` (wrapped in `<ErrorBoundary>`) regardless
   *  of `showThumbnails`. The panel's outer shell stays mounted across
   *  open/close cycles so the CSS slide animation has a stable in-DOM
   *  element to transition; toggles its `data-open` attribute based on
   *  `state.thumbnailsOpen`; only the inner content (scroll container +
   *  buttons + canvases) mounts when actually open. Pass `null` only for
   *  low-level/test consumption of `<FlipbookProvider>` that wants no
   *  panel slot at all. */
  thumbnailsNode?: ReactNode | null;
  /** Optional test/integration children mounted inside the full context
   *  stack (Flipbook + Store + PageRegistry) but OUTSIDE the visible
   *  `.fbjs-container` div, so they have access to all the public hooks
   *  (`useFlipbook`, `useFlipbookSelector`, `useFlipbookActions`,
   *  `useFlipbookContext`) without interfering with the viewer UI.
   *  `Flipbook.tsx` does NOT pass children; this is for renderHook-based
   *  tests in Phase 7 and for advanced consumers who need to render an
   *  ad-hoc component alongside the viewer with shared state. */
  children?: ReactNode;
}

export function FlipbookProvider({
  source,
  viewMode,
  initialPage,
  renderError,
  renderLoading,
  enablePageCurl = false,
  defaultScale = 'fit-page',
  initialTheme = 'light',
  onThemeChange,
  toolbarTopNode = null,
  toolbarBottomNode = null,
  thumbnailsNode = null,
  children,
}: FlipbookProviderProps) {
  // 1. Reducer
  // useReducer's lazy init takes a single argument; bundle viewMode + defaultScale
  // through a closure rather than threading both through the initializer signature.
  const [state, dispatch] = useReducer(
    flipbookReducer,
    undefined,
    () => createInitialState(viewMode ?? 'auto', defaultScale, initialTheme),
  );

  const onThemeChangeRef = useRef(onThemeChange);
  useIsomorphicLayoutEffect(() => {
    onThemeChangeRef.current = onThemeChange;
  }, [onThemeChange]);

  const themeRef = useRef(state.theme);
  useIsomorphicLayoutEffect(() => {
    themeRef.current = state.theme;
  }, [state.theme]);

  const thumbnailsOpenRef = useRef(state.thumbnailsOpen);
  useIsomorphicLayoutEffect(() => {
    thumbnailsOpenRef.current = state.thumbnailsOpen;
  }, [state.thumbnailsOpen]);

  // Dev-mode warning when defaultScale changes after mount. The prop is
  // uncontrolled by design (initial-state factory only; consumer must remount
  // with fresh React `key` to change). Consumers migrating from controlled-
  // pattern viewers may not realize this; the warning surfaces the gotcha at
  // dev time. Production: silent (NODE_ENV !== 'production' gate).
  const initialDefaultScaleRef = useRef(defaultScale);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && defaultScale !== initialDefaultScaleRef.current) {
      console.warn(
        '[flipbook] defaultScale changed from '
        + `${JSON.stringify(initialDefaultScaleRef.current)} to ${JSON.stringify(defaultScale)} `
        + 'after mount — uncontrolled prop, ignored. To switch scale at runtime, dispatch '
        + 'via toolbar (Step 6+) or remount with a fresh React `key`.',
      );
    }
  }, [defaultScale]);

  // 2. Source lifecycle
  const sourceState = usePageSource(source);
  const isReady = sourceState.status === 'ready' && sourceState.source === source;
  const currentError = sourceState.status === 'error' && sourceState.source === source
    ? sourceState.error
    : null;
  // 2a. Source-status fields surfaced into FlipbookContextValue (6A — Decision 1).
  // SourceState's 'loading' branch has NO `source` field (see usePageSource.ts:
  // `{ status: 'loading' } | { status: 'ready'; source } | { status: 'error'; ... source }`),
  // so we MUST narrow on `status` before reading `.source`. The narrowing also
  // implements the stale-source guard that `isReady`/`currentError` already use:
  // when the consumer changes `<Flipbook url=...>`, there's a render window
  // where sourceState still carries the OLD source. During that window we
  // report 'loading' so consumers don't render the old document under a new
  // status.
  const sourceStatus: 'loading' | 'ready' | 'error' =
    (sourceState.status === 'ready' || sourceState.status === 'error') &&
    sourceState.source === source
      ? sourceState.status
      : 'loading';
  const sourceError: Error | null = currentError;

  // 3. SOURCE_CHANGED dispatch
  const processedSourceRef = useRef<PageSource | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!isReady) return;
    if (processedSourceRef.current === source) return; // already dispatched for this source

    const isFirst = processedSourceRef.current === null;
    processedSourceRef.current = source;

    const pageCount = source.getPageCount();
    if (isFirst) {
      const spreads = computeSpreads(pageCount, state.resolvedViewMode);
      const initialSpreadIndex = findSpreadByPageIndex(initialPage ?? 0, spreads);
      dispatch({ type: 'SOURCE_CHANGED', pageCount, initialSpreadIndex });
    } else {
      dispatch({ type: 'SOURCE_CHANGED', pageCount });
    }
  }, [isReady, source, state.resolvedViewMode, initialPage]);

  // 4. viewMode prop sync
  useEffect(() => {
    const mode = viewMode ?? 'auto';
    if (mode !== state.viewMode) {
      dispatch({ type: 'SET_VIEW_MODE', mode });
    }
  }, [viewMode, state.viewMode]);

  // 5. ResizeObserver
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // 5a. PageRegistry (3B) — created once per provider instance. Both contexts
  // share one ref-held Map per Decision 3. Stable references across renders.
  const pageRegistryRef = useRef<ReturnType<typeof createPageRegistry> | null>(null);
  if (pageRegistryRef.current === null) {
    pageRegistryRef.current = createPageRegistry();
  }
  const pageRegistry = pageRegistryRef.current;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      dispatch({ type: 'CONTAINER_RESIZED', width, height });
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 5c. Curl chunk preload (3B) — when enablePageCurl is true, fetch the lazy
  // chunk on mount so the user's first gesture doesn't race the network. The
  // dynamic import is cached by the module loader after first call — flipping
  // enablePageCurl true→false→true doesn't re-fetch the chunk.
  //
  // .catch() is REQUIRED — without it, a chunk-load failure becomes an unhandled
  // promise rejection (dev console noise; surfaces in production error trackers like
  // Sentry). When the chunk really fails, the SAME cached rejection re-throws when
  // CurlOverlay mounts via Suspense, and CurlChunkErrorBoundary catches it. The
  // preload is for warmup speed, not for correctness — it MUST stay quiet on failure.
  useEffect(() => {
    if (!enablePageCurl) return;
    import('./curl/CurlOverlay').catch((err) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          '[flipbook] curl chunk preload failed; CurlOverlay will retry via Suspense '
          + 'and CurlChunkErrorBoundary will handle the failure on mount',
          err,
        );
      }
    });
  }, [enablePageCurl]);

  // 6. Derived values
  const spreads = useMemo(
    () => computeSpreads(state.pageCount, state.resolvedViewMode),
    [state.pageCount, state.resolvedViewMode],
  );

  const { effectiveScale, isOverflowing } = useMemo(() => {
    // Loading/transient-state guard — extended from Step 2's original
    // `!isReady || pageCount === 0` check to also cover `containerWidth === 0`
    // and `containerHeight === 0` (M1 fix from template-5/6 review). Without
    // the container-dim check, the brief transient between `isReady=true` and
    // ResizeObserver firing produces `containerWidth=0` AND `pageCount>0`,
    // which the prior guard let through. With MIN_AVAILABLE=1 floor, the
    // derivation then computed scaledWidth=1 > containerWidth=0 → false
    // positive `isOverflowing=true`. Consumers gating on isOverflowing would
    // briefly disable curl / relax touch-action for no real reason.
    //
    // Loading-phase defaults: effectiveScale=1, isOverflowing=false. Safe
    // defaults for both consumers (don't disable curl, don't switch
    // touch-action — there's no content to react to yet).
    if (!isReady || state.pageCount === 0 || state.containerWidth === 0 || state.containerHeight === 0) {
      return { effectiveScale: 1, isOverflowing: false };
    }
    const pageSize = source.getPageSize(0);

    // M2 fix (template-1 review): math extracted to a pure function
    // `deriveEffectiveScaleAndOverflow` in src/zoom/derivation.ts — unit-tested
    // directly. Provider's useMemo only handles the loading guard + input
    // marshalling; the formula itself lives in the testable pure function.
    return deriveEffectiveScaleAndOverflow({
      zoomMode: state.zoomMode,
      customScale: state.customScale,
      resolvedViewMode: state.resolvedViewMode,
      containerWidth: state.containerWidth,
      containerHeight: state.containerHeight,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
    });
  }, [
    isReady,
    state.pageCount,
    state.resolvedViewMode,
    state.containerWidth,
    state.containerHeight,
    state.zoomMode,
    state.customScale,
    source,
  ]);

  // 6a. Wheel-handler refs (live-params pattern). All values the wheel router
  // needs change at React-render frequency; the listener attaches once and
  // reads fresh values each event via these refs. Same approach as
  // usePageCurlGesture's liveParamsRef (curl/usePageCurlGesture.ts:123-124).
  const effectiveScaleRef = useRef(effectiveScale);
  effectiveScaleRef.current = effectiveScale;
  const isOverflowingRef = useRef(isOverflowing);
  isOverflowingRef.current = isOverflowing;
  // Loading-state ref: the wheel router reads isReady to suppress Ctrl+wheel
  // during the pre-isReady window (otherwise the loading-default effectiveScale=1
  // would silently transition zoomMode → 'custom'). Handled inside routeWheelEvent.
  const isReadyRef = useRef(isReady);
  isReadyRef.current = isReady;

  // Curl handler registration — ref-backed setter, no re-render on register/unregister.
  const curlWheelHandlerRef = useRef<((d: 'next' | 'previous') => void) | null>(null);
  const registerCurlWheelHandler = useCallback(
    (handler: ((d: 'next' | 'previous') => void) | null) => {
      curlWheelHandlerRef.current = handler;
    },
    [],
  );

  // Leading-edge zoom throttle state — see useWheelRouter for the throttle logic.
  // Initialized to -Infinity so the FIRST wheel event is never swallowed by the
  // throttle window. With `0` as the initial value, a user's first Ctrl+wheel
  // within the first 150ms after mount would see `now - 0 < 150 → drop`.
  // -Infinity ensures `now - (-Infinity) === Infinity`, which is always
  // >= throttleMs → first event fires. Matches the old fork's lastWheelRef
  // pattern at usePageCurlGesture.ts:145 (preserved in `decideCurlWheelDispatch`'s
  // CurlWheelDecisionInputs.lastWheelTimestamp default).
  const lastZoomTimestampRef = useRef<number>(-Infinity);

  // 6b. Wheel listener attachment + side-effect orchestration. The pure routing
  // logic lives in `routeWheelEvent` (zoom/wheelRouter.ts) — table-driven
  // unit-testable. The `useWheelRouter` hook attaches the listener to
  // containerRef and maps the returned WheelRoute to side effects (preventDefault
  // on the event, dispatch SET_ZOOM, invoke curl callback).
  //
  // ATTACHMENT TARGET: containerRef, NOT stageRef. `.fbjs-container` is
  // unconditional (renders inside <FlipbookContext.Provider> opened at line 214 below; the .fbjs-container div is line 217);
  // `.fbjs-stage` only renders when showContent === true. An empty-deps effect
  // keyed on stageRef.current would see null on initial render and never
  // re-attach. Container is unconditional → listener fires once on mount with
  // non-null ref and stays attached. Wheel events from the inner stage bubble
  // up to container.
  useWheelRouter({
    containerRef,
    isReadyRef,
    isOverflowingRef,
    effectiveScaleRef,
    curlWheelHandlerRef,
    lastZoomTimestampRef,
    dispatch,
  });

  // 7. Ready gate
  const showContent = isReady && state.containerWidth > 0 && state.containerHeight > 0;

  // 8. Render
  const contextValue = useMemo(
    () => ({
      state, dispatch, source, spreads, effectiveScale, isOverflowing, registerCurlWheelHandler,
      sourceStatus, sourceError,
    }),
    [
      state, dispatch, source, spreads, effectiveScale, isOverflowing, registerCurlWheelHandler,
      sourceStatus, sourceError,
    ],
  );

  // ============================================================
  // Step 6A: Public hook layer — actions, helpers, snapshot store
  // ============================================================

  // ---- Refs mirroring state/derived values that source-rotating actions
  //      need to read at call time. The provider's actions stay [dispatch]-
  //      stable (do not rotate on every state change) by reading these refs
  //      inside the callback bodies. Per-action dep contract is Decision 1
  //      of the parent plan. Note: `react-hooks/exhaustive-deps` is NOT
  //      enabled in this repo's eslint config (see eslint.config.js — only
  //      `@typescript-eslint` is loaded). The action-stability test (Phase 7)
  //      is the SOLE protection against accidental dep-array drift. If
  //      `eslint-plugin-react-hooks` is added later, the `// eslint-disable-
  //      next-line` comments on each action's deps below become the
  //      enforcement mechanism — but right now they're documentation, not
  //      lint-time gates. Phase 0 Step 0.5 verifies the current state.
  //
  // CRITICAL — `effectiveScaleRef` is REUSED from the existing wheel-router
  // setup (line 230 of the existing FlipbookProvider.tsx). Do NOT redeclare it
  // here — that would be a TypeScript compile error (block-scoped const
  // re-declaration). Both the wheel router and the new zoom actions need to
  // read the latest `effectiveScale` outside of render; one ref serves both.
  // Same applies to `isOverflowingRef` and `isReadyRef` if a downstream sub-
  // plan needs them — reuse the existing wheel-router declarations.
  //
  // The four refs below are NEW (no name collision with the existing wheel-
  // router refs).
  //
  // Note on inline assignment during render: `pageCountRef.current = state.pageCount`
  // is a side effect during the render phase. React's docs flag this as
  // non-recommended in favor of the post-commit `useEffect(() => { ref.current
  // = value }, [value])` pattern. We use inline assignment here because all
  // ref READERS are user-event handlers (action callbacks fired from button
  // clicks; keyboard listener fired from keydown events). User events fire
  // AFTER React commits, so even if a concurrent render is discarded mid-flight,
  // the next committed render's inline assignment overwrites the discarded
  // value before any reader runs. If a future sub-plan reads these refs
  // DURING a render (e.g., from a child component's render body), migrate to
  // the useEffect-based assignment to be concurrent-mode safe.

  const spreadCountRef = useRef(state.spreadCount);
  spreadCountRef.current = state.spreadCount;

  const pageCountRef = useRef(state.pageCount);
  pageCountRef.current = state.pageCount;

  const spreadsRef = useRef(spreads);
  spreadsRef.current = spreads;

  const sourceStatusRef = useRef(sourceStatus);
  sourceStatusRef.current = sourceStatus;

  // ---- Actions (18 total) ----
  // All actions are [dispatch]-stable EXCEPT `print` and `download` which
  // close over `source` (per Decision 1 — they rotate on url change so 6F's
  // implementation can read the latest source instance). Every other action
  // reads state/derived values via the refs above.

  const next      = useCallback(() => dispatch({ type: 'NEXT_SPREAD' }),                              [dispatch]);
  const previous  = useCallback(() => dispatch({ type: 'PREV_SPREAD' }),                              [dispatch]);
  const goToFirst = useCallback(() => dispatch({ type: 'GO_TO_SPREAD', index: 0 }),                   [dispatch]);

  // goToLast: status guard for developer-facing correctness, NOT for reducer
  // safety. The reducer's `clampSpreadIndex(index, spreadCount)` at
  // flipbookReducer.ts:28-31 short-circuits to 0 when `spreadCount <= 0`, and
  // clamps `Math.max(0, Math.min(index, spreadCount-1))` otherwise — so
  // `GO_TO_SPREAD { index: -1 }` lands at spreadIndex=0 either way. The
  // reducer-level behavior is safe.
  //
  // What the guard prevents is a SILENT no-op during development: a dev calls
  // `goToLast()` during the loading window (spreadCountRef.current === 0),
  // expects to land on the last spread, and sees nothing happen (because
  // currentSpreadIndex is already 0). Without the guard, that surface zero
  // signal — no error, no warning, no log. With the guard, devWarn fires
  // once-per-mount with the actual `status` value, pointing the dev at the
  // real fix (`await ready` before calling). Same warned-ref pattern as
  // goToPage. goToFirst doesn't need this because `index: 0` matches the
  // reducer's clamp target in both states (loading and ready) and is the
  // expected destination either way — no surprising no-op. `next`/`previous`
  // are also safe because NEXT_SPREAD/PREV_SPREAD are clamp-by-construction
  // in the reducer. The End-key keyboard shortcut routes through this action
  // (see Phase 4.5) so the dev-warning covers both invocation paths.
  const goToLastNotReadyWarnedRef = useRef(false);
  const goToLast = useCallback(() => {
    if (sourceStatusRef.current !== 'ready') {
      if (!goToLastNotReadyWarnedRef.current) {
        goToLastNotReadyWarnedRef.current = true;
        devWarn(
          `[flipbook] actions.goToLast() called while status='${sourceStatusRef.current}'. No-op until status='ready'. This warning fires once per provider mount.`,
        );
      }
      return;
    }
    dispatch({ type: 'GO_TO_SPREAD', index: spreadCountRef.current - 1 });
  }, [dispatch]);

  // goToPage: 1-indexed contract. Decision 1's helper spec rejects NaN /
  // non-integer / out-of-range with a one-shot dev warning. Also rejects calls
  // while status !== 'ready' — without this guard, the action would dispatch
  // GO_TO_SPREAD against an empty reducer state (pageCount=0, spreadCount=0),
  // which would clamp to spreadIndex 0 (no-op) but pollute the dispatch log.
  //
  // TWO warned-refs (not one): "called during loading" and "called with invalid
  // input" are distinct classes of bug, each deserving its own one-shot warning.
  // A user who hits one bug during development shouldn't be silenced from
  // discovering the other later.
  const goToPageNotReadyWarnedRef = useRef(false);
  const goToPageInvalidWarnedRef  = useRef(false);
  const goToPage = useCallback((pageNumber: number) => {
    if (sourceStatusRef.current !== 'ready') {
      if (!goToPageNotReadyWarnedRef.current) {
        goToPageNotReadyWarnedRef.current = true;
        devWarn(
          `[flipbook] actions.goToPage(${pageNumber}) called while status='${sourceStatusRef.current}'. No-op until status='ready'. This warning fires once per provider mount.`,
        );
      }
      return;
    }
    const totalPages = pageCountRef.current;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) {
      if (!goToPageInvalidWarnedRef.current) {
        goToPageInvalidWarnedRef.current = true;
        devWarn(
          `[flipbook] actions.goToPage(${pageNumber}) — invalid input (must be a positive integer ≤ totalPages=${totalPages}). No-op. This warning fires once per provider mount.`,
        );
      }
      return;
    }
    const spreadIndex = findSpreadByPageIndex(pageNumber - 1, spreadsRef.current);
    dispatch({ type: 'GO_TO_SPREAD', index: spreadIndex });
  }, [dispatch]);

  const zoomIn = useCallback(() => {
    const nextScale = increase(effectiveScaleRef.current);
    dispatch({ type: 'SET_ZOOM', mode: 'custom', customScale: nextScale });
  }, [dispatch]);

  const zoomOut = useCallback(() => {
    const nextScale = decrease(effectiveScaleRef.current);
    dispatch({ type: 'SET_ZOOM', mode: 'custom', customScale: nextScale });
  }, [dispatch]);

  const setZoom = useCallback((scale: DefaultScale) => {
    if (scale === 'fit-page' || scale === 'fit-width') {
      dispatch({ type: 'SET_ZOOM', mode: scale });
      return;
    }
    if (scale === SpecialZoomLevel.ActualSize) {
      dispatch({ type: 'SET_ZOOM', mode: 'custom', customScale: 1 });
      return;
    }
    dispatch({ type: 'SET_ZOOM', mode: 'custom', customScale: scale });
  }, [dispatch]);

  const fitPage  = useCallback(() => dispatch({ type: 'SET_ZOOM', mode: 'fit-page'  }), [dispatch]);
  const fitWidth = useCallback(() => dispatch({ type: 'SET_ZOOM', mode: 'fit-width' }), [dispatch]);

  // Stub actions — bodies replaced by downstream sub-plans. Signatures stable.
  const enterFullScreen    = useCallback((): Promise<void> => Promise.resolve(), []);  // 6E
  const exitFullScreen     = useCallback((): Promise<void> => Promise.resolve(), []);  // 6E
  const toggleFullScreen   = useCallback((): Promise<void> => Promise.resolve(), []);  // 6E
  const setTheme = useCallback((theme: 'light' | 'dark') => {
    dispatch({ type: 'SET_THEME', value: theme });
    onThemeChangeRef.current?.(theme);
  }, [dispatch]);
  const toggleTheme = useCallback(() => {
    const next = themeRef.current === 'dark' ? 'light' : 'dark';
    dispatch({ type: 'SET_THEME', value: next });
    onThemeChangeRef.current?.(next);
  }, [dispatch]);
  const setThumbnailsOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_THUMBNAILS_OPEN', value: open });
  }, [dispatch]);
  const toggleThumbnails = useCallback(() => {
    dispatch({ type: 'SET_THUMBNAILS_OPEN', value: !thumbnailsOpenRef.current });
  }, [dispatch]);
  const setInteractionMode = useCallback((_mode: 'select' | 'pan') => {},          []); // 6E

  // Source-bound stubs — rotate on source change (per Decision 1 contract).
  // 6F replaces the bodies with the actual print pipeline + download.
  const print: () => Promise<void> = useCallback(() => Promise.resolve(), [source]);
  const download: () => void       = useCallback(() => {},                [source]);

  // ---- Actions object: useMemo so identity is stable across non-source-
  //      change renders. Every action ref above is stable except print/download
  //      (which rotate on source change), so this memo rotates only when
  //      source rotates. useFlipbookActions reads this via Object.is.
  const actions = useMemo<FlipbookHookActions>(() => ({
    next, previous, goToPage, goToFirst, goToLast,
    zoomIn, zoomOut, setZoom, fitPage, fitWidth,
    enterFullScreen, exitFullScreen, toggleFullScreen,
    setTheme, toggleTheme,
    setThumbnailsOpen, toggleThumbnails,
    setInteractionMode,
    print, download,
  }), [
    next, previous, goToPage, goToFirst, goToLast,
    zoomIn, zoomOut, setZoom, fitPage, fitWidth,
    enterFullScreen, exitFullScreen, toggleFullScreen,
    setTheme, toggleTheme,
    setThumbnailsOpen, toggleThumbnails,
    setInteractionMode,
    print, download,
  ]);

  // ---- Helpers ----
  // canFullScreen detected once at mount via SSR-safe check; canDownload is
  // always false in 6A (6F enables via getSourceUrl). pageToSpreadIndex is
  // the 1-indexed public helper — a thin validation wrapper over the
  // 0-indexed internal `findSpreadByPageIndex` (computeSpreads.ts).
  //
  // The helper reads state via REFS (same pattern as `goToPage` above) so:
  //   1. Consumers who cache `helpers.pageToSpreadIndex` get always-current
  //      results — no stale closures.
  //   2. The `helpers` useMemo deps narrow to [canFullScreen], which is
  //      effectively constant after mount. So helpers identity is STABLE for
  //      the provider's lifetime — fewer cascading snapshot rotations for
  //      subscribers that read e.g. only `helpers.canDownload`.
  //
  // 6F will reintroduce a dep when it adds `canDownload` based on
  // `getSourceUrl()` — at that point, helpers will rotate on source change,
  // matching the action-stability contract.
  const canFullScreen = useMemo(
    () => typeof document !== 'undefined' && document.fullscreenEnabled,
    [],
  );
  const helpers = useMemo<FlipbookHookHelpers>(() => ({
    canDownload: false,   // 6F overwrites via getSourceUrl detection
    canFullScreen,
    pageToSpreadIndex: (pageNumber: number): number => {
      if (sourceStatusRef.current !== 'ready') return -1;
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCountRef.current) return -1;
      // The internal helper returns 0 (clamped) for not-found, but our bounds
      // check above guarantees the page is in range — so the result is the
      // real spread index.
      return findSpreadByPageIndex(pageNumber - 1, spreadsRef.current);
    },
  }), [canFullScreen]);   // narrow deps — pageToSpreadIndex reads live state via refs

  // ---- Curated hook state (the `state` field of FlipbookSnapshot / FlipbookHook) ----
  const hookState = useMemo<FlipbookHookState>(() => {
    const currentSpread = spreads[state.currentSpreadIndex];
    const anchorPage0 = currentSpread
      ? (currentSpread.left ?? currentSpread.right ?? 0)
      : 0;
    return {
      pageNumber: state.pageCount > 0 ? anchorPage0 + 1 : 1,
      totalPages: state.pageCount,
      spreadIndex: state.currentSpreadIndex,
      spreadCount: state.spreadCount,
      viewMode: state.viewMode,
      resolvedViewMode: state.resolvedViewMode,
      zoomMode: state.zoomMode,
      customScale: state.customScale,
      effectiveScale,
      isOverflowing,
      isFullScreen: state.isFullScreen,
      theme: state.theme,
      interactionMode: state.interactionMode,
      isPrinting: state.isPrinting,
      printError: state.printError,
      thumbnailsOpen: state.thumbnailsOpen,
    };
  }, [
    spreads, state.currentSpreadIndex, state.pageCount, state.spreadCount,
    state.viewMode, state.resolvedViewMode, state.zoomMode, state.customScale,
    effectiveScale, isOverflowing,
    state.isFullScreen, state.theme, state.interactionMode, state.isPrinting, state.printError,
    state.thumbnailsOpen,
  ]);

  // ---- Snapshot store (commit-only) ----
  // The candidate snapshot is built during render. The ref is mutated AND
  // listeners are notified in a layout effect — gating both on commit prevents
  // discarded concurrent renders from leaking through getSnapshot().
  const nextSnapshot = useMemo<FlipbookSnapshot>(() => ({
    status: sourceStatus,
    error: sourceError,
    source: sourceStatus === 'ready' ? source : null,
    state: hookState,
    actions,
    helpers,
  }), [sourceStatus, sourceError, source, hookState, actions, helpers]);

  const snapshotRef = useRef<FlipbookSnapshot>(nextSnapshot);
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Commit-only snapshot update + listener notification. `useIsomorphicLayoutEffect`
  // falls back to `useEffect` on the server (where layout effects are
  // semantically meaningless and older React versions emit a warning;
  // React 18+ — including the 19.x currently installed — generally skip
  // the warning, but the helper keeps us defensive across all targets).
  //
  // The listeners in `listenersRef.current` are the functions React passes via
  // useSyncExternalStore's `subscribe(listener)` argument — they are React's
  // internal store-subscription callbacks, NOT user-defined functions. We do
  // NOT wrap the iteration in try/catch: if a listener throws, that surfaces
  // either a corrupted listener set (a bug we want to crash on) or a selector
  // that threw on snapshot re-read (which React's reconciler propagates to the
  // nearest <ErrorBoundary> — the documented, idiomatic place to handle it).
  // Swallowing the throw here would hide both classes of bug from React's
  // error-boundary mechanism. The Redux precedent for swallowing is not
  // analogous: Redux subscribers are user-defined functions executed outside
  // React's reconciliation; ours are React-internal callbacks executed inside it.
  useIsomorphicLayoutEffect(() => {
    snapshotRef.current = nextSnapshot;
    listenersRef.current.forEach((listener) => listener());
  }, [nextSnapshot]);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);
  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const getServerSnapshot = useCallback(() => SSR_SNAPSHOT, []);

  const storeValue = useMemo(
    () => ({ subscribe, getSnapshot, getServerSnapshot }),
    [subscribe, getSnapshot, getServerSnapshot],
  );

  // ---- Keyboard shortcuts (replaces the old useKeyboard call at line 152) ----
  // Wired with the `actions` object so Ctrl+0/+/-, f, End, and Escape route
  // through the public action layer rather than building raw dispatches.
  // Editable-target suppression + Escape exemption are inside the hook (Decision 4).
  //
  // Signature change vs. the old `useKeyboard`: the new hook does NOT take a
  // `spreadCount` argument. The End-key bounds come from `actions.goToLast()`
  // (which reads `spreadCountRef` defined above). This is what lets the
  // keydown listener be permanently bound: nothing the hook reads is
  // per-render-fresh — everything routes through stable refs.
  //
  // IMPORTANT: this call replaces the existing `useKeyboard(containerRef,
  // dispatch, state.spreadCount)` at the original FlipbookProvider.tsx line 152.
  // Phase 6 deletes that old call site. The new call site lives HERE (Step 5.3)
  // because it depends on `actions` (defined above) which doesn't exist at the
  // old line 152.
  useKeyboardShortcuts(containerRef, dispatch, actions);

  // Decision 10: curl needs the full spread visible. When isOverflowing flips true
  // (zoom past fit-page), the overlay unmounts; useCurlMode cleanup runs; curl
  // module's wheel-handler registration unregisters via the cleanup path. When
  // isOverflowing flips back false (resize-larger or zoom-out), the overlay
  // remounts and re-registers.
  //
  // Cancellation is belt-and-suspenders:
  //   (1) overlay unmount path — useCurlMode's `enabled` effect (3B Decision 18)
  //       fires on enabled true→false and bumps cancelSignal + cancels animation.
  //   (2) effectiveScale-change path — useCurlMode's cancellation effect bumps
  //       cancelSignal on any effectiveScale transition (even when isOverflowing
  //       does NOT trip — e.g., zoom from 1.0→1.1 with spread still fitting).
  //       Cancels in-flight curl that would otherwise read stale pageWidth/
  //       pageHeight derived from the new effectiveScale.
  // Both paths increment the same counter; redundant but harmless.
  const showCurlOverlay = showContent
    && enablePageCurl
    && state.resolvedViewMode === 'dual-cover'
    && !isOverflowing;

  return (
    <FlipbookContext.Provider value={contextValue}>
      <FlipbookStoreContext.Provider value={storeValue}>
        <PageRegistryWriteContext.Provider value={pageRegistry.write}>
          <PageRegistryReadContext.Provider value={pageRegistry.read}>
            <div className="fbjs-root" data-theme={state.theme}>
              {toolbarTopNode}
              <div
                ref={containerRef}
                className="fbjs-container"
                role="region"
                aria-label="Document viewer"
                tabIndex={0}
              >
                {currentError && (
                  renderError?.(currentError) ?? (
                    <div role="alert" className="fbjs-error">
                      <p>Unable to load document</p>
                      <p>{currentError.message}</p>
                    </div>
                  )
                )}
                {!showContent && !currentError && (
                  renderLoading?.() ?? <LoadingState />
                )}
                {showContent && (
                  <div
                    ref={stageRef}
                    data-testid="fbjs-ready"
                    className="fbjs-stage"
                    data-overflowing={isOverflowing ? 'true' : undefined}
                  >
                    <ErrorBoundary>
                      <SpreadRenderer />
                      <AriaAnnouncer />
                      {showCurlOverlay && (
                        <CurlChunkErrorBoundary>
                          <Suspense fallback={null}>
                            <LazyCurlOverlay stageRef={stageRef} />
                          </Suspense>
                        </CurlChunkErrorBoundary>
                      )}
                    </ErrorBoundary>
                  </div>
                )}
              </div>
              {thumbnailsNode}
              {toolbarBottomNode}
            </div>
            {children}
          </PageRegistryReadContext.Provider>
        </PageRegistryWriteContext.Provider>
      </FlipbookStoreContext.Provider>
    </FlipbookContext.Provider>
  );
}
