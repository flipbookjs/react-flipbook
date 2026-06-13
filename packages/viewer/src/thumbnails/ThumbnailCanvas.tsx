import { memo, useEffect, useRef } from 'react';
import type { PageSource } from '../types/PageSource';

interface ThumbnailCanvasProps {
  source: PageSource;
  pageIndex: number;       // 0-indexed; consistent with PageSource.renderPage
  width: number;           // computed CSS pixels (panel-supplied; matches `scale × getPageSize(pageIndex).width`)
  height: number;
  /** Page-relative render scale (DPR not included). The canvas multiplies
   *  by DPR internally. `ThumbnailPanel.resolveItemDimensions` is the
   *  single source of truth for this value. Keeping it as a prop (vs the
   *  0.1.0-alpha.1 module-level `THUMB_SCALE = 0.2` constant) is what lets
   *  larger `thumbnailSize` values stay crisp on Retina: backing-store
   *  resolution scales with the displayed CSS size. */
  scale: number;
}

/**
 * Renders a single thumbnail canvas via `PageSource.renderPage(pageIndex,
 * scale × devicePixelRatio, signal)`. The returned canvas is mounted
 * directly into the host div via imperative `appendChild` so React manages
 * the host but does not reconcile the canvas's children (no React inside
 * the canvas).
 *
 * **DPR awareness**: the rendered canvas's backing store is sized at
 * `pageSize × scale × devicePixelRatio`. The canvas's CSS width / height
 * is explicitly set to the panel-supplied `width` / `height` (no DPR
 * multiplier) so it DISPLAYS at the host's logical size but RENDERS at
 * the display's native pixel density. On Retina / high-DPI displays
 * (every Mac since 2012, every modern Windows laptop, every recent
 * Android, every iOS device) this is the difference between crisp
 * thumbnails and visibly-blurry bilinear upscale.
 *
 * On unmount or `source` rotation: aborts the in-flight render via the
 * AbortController, and clears the canvas backing store (`width = 0;
 * height = 0`) to release GPU/CPU memory.
 *
 * Memoized: re-renders when `source`, `pageIndex`, or `scale` changes
 * (the latter so a runtime `thumbnailSize` prop change re-rasterizes the
 * page at the new backing-store resolution). `width` / `height` are
 * CSS-only — applied via inline style on the host div and the rendered
 * canvas — and changes there flow naturally through the parent re-render.
 */
export const ThumbnailCanvas = memo(function ThumbnailCanvas({
  source,
  pageIndex,
  width,
  height,
  scale,
}: ThumbnailCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    // DPR-aware render scale. Read once at effect mount; changing DPR
    // mid-session (very rare — happens when dragging the window between
    // monitors with different scaling) would require a window event
    // listener and a re-render. v0.1 reads once; if a
    // consumer reports the rare case, v0.2 can add the listener.
    const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
    const renderScale = scale * dpr;
    const controller = new AbortController();
    let canvas: HTMLCanvasElement | null = null;
    let aborted = false;

    void source
      .renderPage(pageIndex, renderScale, controller.signal)
      .then((rendered) => {
        if (aborted) return;
        // Display at CSS-size (host's logical pixels); backing-store
        // remains at `renderScale × pageSize` (DPR-multiplied). Browser
        // downscales from backing to CSS, producing crisp output on
        // high-DPI displays.
        rendered.style.width = `${width}px`;
        rendered.style.height = `${height}px`;
        canvas = rendered;
        host.appendChild(rendered);
      })
      .catch((err: unknown) => {
        // AbortError on unmount / source rotation is expected — the
        // cleanup path below tears down state; nothing to log.
        if (err instanceof Error && err.name === 'AbortError') return;
        // Real failure (pdfjs parse error, network drop, etc.). Log in
        // dev so debugging "why are thumbnails not rendering on this
        // PDF?" has a visible signal. Production stays silent — a
        // missing thumbnail is preferable to console-spam regressions
        // in consumer apps. Matches the FlipbookProvider dev-warn
        // pattern (e.g., the `defaultScale changed after mount` warning).
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[flipbook] thumbnail render failed for page ${pageIndex + 1}:`,
            err,
          );
        }
      });

    return () => {
      aborted = true;
      controller.abort();
      if (canvas !== null) {
        // Memory discipline — see file header.
        canvas.width = 0;
        canvas.height = 0;
        canvas.remove();
      }
    };
  }, [source, pageIndex, width, height, scale]);

  return (
    <div
      ref={hostRef}
      className="fbjs-thumbnail-button__canvas-host"
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
    />
  );
});
