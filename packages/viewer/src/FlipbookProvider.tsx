import {
  useReducer,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import type { PageSource } from './types/PageSource';
import { usePageSource } from './hooks/usePageSource';
import { flipbookReducer, createInitialState } from './core/flipbookReducer';
import { computeSpreads, pageToSpreadIndex } from './core/computeSpreads';
import { LoadingState } from './components/LoadingState';
import { FlipbookContext } from './core/FlipbookContext';
import { SpreadRenderer } from './components/SpreadRenderer';
import { AriaAnnouncer } from './components/AriaAnnouncer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useKeyboard } from './hooks/useKeyboard';
import {
  PageRegistryWriteContext,
  PageRegistryReadContext,
  createPageRegistry,
} from './core/PageRegistry';
import { CurlChunkErrorBoundary } from './curl/CurlChunkErrorBoundary';

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
}

export function FlipbookProvider({
  source,
  viewMode,
  initialPage,
  renderError,
  renderLoading,
  enablePageCurl = false,
}: FlipbookProviderProps) {
  // 1. Reducer
  const [state, dispatch] = useReducer(
    flipbookReducer,
    viewMode,
    (vm) => createInitialState(vm ?? 'auto'),
  );

  // 2. Source lifecycle
  const sourceState = usePageSource(source);
  const isReady = sourceState.status === 'ready' && sourceState.source === source;
  const currentError = sourceState.status === 'error' && sourceState.source === source
    ? sourceState.error
    : null;

  // 3. SOURCE_CHANGED dispatch
  const processedSourceRef = useRef<PageSource | null>(null);

  useLayoutEffect(() => {
    if (!isReady) return;
    if (processedSourceRef.current === source) return; // already dispatched for this source

    const isFirst = processedSourceRef.current === null;
    processedSourceRef.current = source;

    const pageCount = source.getPageCount();
    if (isFirst) {
      const spreads = computeSpreads(pageCount, state.resolvedViewMode);
      const initialSpreadIndex = pageToSpreadIndex(initialPage ?? 0, spreads);
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

  // 5b. Keyboard navigation
  useKeyboard(containerRef, dispatch, state.spreadCount);

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

  const effectiveScale = useMemo(() => {
    // Guard: source.getPageSize() is only safe after init. During source
    // transitions, `source` has changed but usePageSource hasn't caught up
    // yet — isReady is false while the new source is uninitialized.
    // Without this guard, source.getPageSize(0) returns undefined → crash.
    if (!isReady || state.pageCount === 0) return 1;
    const pageSize = source.getPageSize(0);
    const spreadWidth = state.resolvedViewMode === 'dual-cover'
      ? pageSize.width * 2
      : pageSize.width;
    const spreadHeight = pageSize.height;
    const CONTAINER_PADDING = 16;
    const MIN_AVAILABLE = 1;
    const availableWidth = Math.max(MIN_AVAILABLE, state.containerWidth - CONTAINER_PADDING * 2);
    const availableHeight = Math.max(MIN_AVAILABLE, state.containerHeight - CONTAINER_PADDING * 2);
    const scaleX = availableWidth / spreadWidth;
    const scaleY = availableHeight / spreadHeight;
    return Math.min(scaleX, scaleY);
  }, [isReady, state.pageCount, state.resolvedViewMode, state.containerWidth, state.containerHeight, source]);

  // 7. Ready gate
  const showContent = isReady && state.containerWidth > 0 && state.containerHeight > 0;

  // 8. Render
  const contextValue = useMemo(
    () => ({ state, dispatch, source, spreads, effectiveScale }),
    [state, dispatch, source, spreads, effectiveScale],
  );

  const showCurlOverlay = showContent
    && enablePageCurl
    && state.resolvedViewMode === 'dual-cover';

  return (
    <FlipbookContext.Provider value={contextValue}>
      <PageRegistryWriteContext.Provider value={pageRegistry.write}>
        <PageRegistryReadContext.Provider value={pageRegistry.read}>
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
              <div ref={stageRef} data-testid="fbjs-ready" className="fbjs-stage">
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
        </PageRegistryReadContext.Provider>
      </PageRegistryWriteContext.Provider>
    </FlipbookContext.Provider>
  );
}
