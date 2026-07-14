import { useRef, useEffect, useState, useContext, useCallback } from 'react';
import type { PageSource } from '../types/PageSource';
import { PageRegistryWriteContext } from '../core/PageRegistry';
import { useFlipbookContext } from '../core/FlipbookContext';
import { useFlipbookActions } from '../hooks/useFlipbook';
import { LinkOverlay } from './LinkOverlay';

interface PageRendererProps {
  source: PageSource;
  pageIndex: number;
  scale: number;
}

export function PageRenderer({ source, pageIndex, scale }: PageRendererProps) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const pageDivRef = useRef<HTMLDivElement>(null);
  const registry = useContext(PageRegistryWriteContext);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<Error | null>(null);
  const { showLinks } = useFlipbookContext();
  const { goToPage } = useFlipbookActions();
  // Memoize so LinkOverlay's 200 buttons don't churn their onClick handlers
  // on every parent render.
  const handleInternalLink = useCallback(
    (destPage: number) => goToPage(destPage + 1),  // goToPage is 1-indexed
    [goToPage],
  );

  useEffect(() => {
    const canvasHost = canvasHostRef.current;
    if (!canvasHost) return;

    const abortController = new AbortController();
    setState('loading');
    setError(null);

    // Clear previous canvas immediately — don't leave stale content
    // visible behind the loading overlay, and release its memory.
    canvasHost.querySelectorAll('canvas').forEach((c) => {
      c.width = 0;
      c.height = 0;
    });
    canvasHost.textContent = '';

    // Account for device pixel ratio
    // Guard for SSR (Next.js) where window doesn't exist
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    // Cap at 2x on mobile (hard-problem #8)
    const isMobile = typeof window !== 'undefined'
      && window.matchMedia('(max-width: 768px)').matches;
    const effectiveDpr = isMobile ? Math.min(dpr, 2) : dpr;
    const renderScale = scale * effectiveDpr;

    source.renderPage(pageIndex, renderScale, abortController.signal)
      .then((canvas) => {
        if (abortController.signal.aborted) {
          // Canvas was created but we no longer need it — release memory
          canvas.width = 0;
          canvas.height = 0;
          return;
        }

        // CSS dimensions (logical pixels)
        // The canvas backing store may be smaller than requested if
        // MAX_CANVAS_SIZE capped it. Setting CSS width/height to the
        // intended size is the soft-upscale: the browser stretches
        // the smaller canvas to fill the CSS box. No transform needed.
        const pageSize = source.getPageSize(pageIndex);
        canvas.style.width = `${pageSize.width * scale}px`;
        canvas.style.height = `${pageSize.height * scale}px`;

        // Release old canvases, insert new one.
        // This only touches canvasHost — React's children are untouched.
        canvasHost.querySelectorAll('canvas').forEach((c) => {
          c.width = 0;
          c.height = 0;
        });
        canvasHost.textContent = '';
        canvasHost.appendChild(canvas);
        setState('ready');
        // Register with PageRegistry per architectural plan Decision 3.
        // Optional chaining: works without provider (tests, isolated usage).
        if (pageDivRef.current) {
          registry?.register(pageIndex, { canvas, element: pageDivRef.current });
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err);
        setState('error');
      });

    return () => {
      abortController.abort();
      // Unregister from PageRegistry per architectural plan Decision 3.
      registry?.unregister(pageIndex);
      // Release canvas memory (hard-problem #8)
      canvasHost?.querySelectorAll('canvas').forEach((c) => {
        c.width = 0;
        c.height = 0;
      });
    };
  }, [source, pageIndex, scale]);

  return (
    <div
      ref={pageDivRef}
      className="fbjs-page"
      role="group"
      aria-label={`Page ${pageIndex + 1}`}
    >
      {/* Imperative canvas zone — React never reconciles this div's children */}
      <div ref={canvasHostRef} className="fbjs-page-canvas" />

      {/* Interactive link hit targets — no-op when source doesn't implement getLinks OR state !== 'ready' */}
      {showLinks && state === 'ready' && (
        <LinkOverlay
          source={source} pageIndex={pageIndex} scale={scale}
          onInternalLinkClick={handleInternalLink}
        />
      )}

      {/* React-managed overlays */}
      {state === 'loading' && (
        <div className="fbjs-page-loading" role="status" aria-label="Loading page">
          {/* Skeleton placeholder — CSS handles the shimmer */}
        </div>
      )}
      {state === 'error' && error && (
        <div className="fbjs-page-error" role="alert">
          <p>Failed to render page {pageIndex + 1}</p>
          <p>{error.message}</p>
        </div>
      )}
    </div>
  );
}
