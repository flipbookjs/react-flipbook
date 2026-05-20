import {
  useReducer,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
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

interface FlipbookProviderProps {
  source: PageSource;
  viewMode?: 'single' | 'dual-cover' | 'auto';
  initialPage?: number;
  renderError?: (error: Error) => ReactNode;
  renderLoading?: () => ReactNode;
}

export function FlipbookProvider({
  source,
  viewMode,
  initialPage,
  renderError,
  renderLoading,
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

  return (
    <FlipbookContext.Provider value={contextValue}>
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
          <div data-testid="fbjs-ready" className="fbjs-stage">
            <ErrorBoundary>
              <SpreadRenderer />
              <AriaAnnouncer />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </FlipbookContext.Provider>
  );
}
