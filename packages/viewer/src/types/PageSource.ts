/**
 * Represents a source of page data for the flipbook viewer.
 * Implemented by PdfjsSource (client-side PDF rendering)
 * and PreRenderedSource (server-side pre-rendered tiles).
 */
export interface PageSource {
  /**
   * Initialize the source. Must be called before any other method.
   * For pdfjs: loads and parses the PDF document.
   * For pre-rendered: fetches document metadata from the API.
   */
  init(): Promise<void>;

  /** Total number of pages in the document. */
  getPageCount(): number;

  /**
   * Page dimensions in CSS pixels at scale 1.0.
   * Available synchronously after init() completes.
   * Returns the ROTATED size (accounts for page rotation).
   */
  getPageSize(index: number): { width: number; height: number };

  /**
   * Return the source URL when this `PageSource` was loaded from one — i.e., a
   * string URL or a `URL` object passed to the implementation's constructor.
   * Return `undefined` for in-memory sources (e.g., `PdfjsSource(Uint8Array)`)
   * or for implementations that don't expose a URL.
   *
   * Used by the toolbar's `<DownloadButton>` to gate the disabled state
   * (`helpers.canDownload = !!source.getSourceUrl?.()`) and to synthesize the
   * download via `<a href={url} download={filename}>`. Cross-origin HTTP(S)
   * URLs will navigate the browser instead of downloading — that's a browser
   * limitation (see "URL validation" note below for the spec details), not
   * a contract violation; sources may still return such URLs.
   *
   * The method is OPTIONAL — implementations that don't implement it leave
   * the download button disabled. Backward-compatible: existing
   * `PageSource` impls continue to compile without changes.
   *
   * **Implementations are responsible for URL validation.** The URL returned
   * here is passed unchanged to `<a href={url}>`. Implementations that
   * construct sources from user-supplied input (e.g., a CMS storing
   * user-uploaded PDF URLs) MUST validate the URL scheme + host at
   * construction time before letting it reach `getSourceUrl()`. The library
   * does NOT filter `javascript:`, `data:text/html`, or other potentially
   * hostile schemes — that defense belongs at the source-construction
   * boundary, not in the consumer-facing download action. The returned URL
   * should ideally be SAME-ORIGIN (cross-origin URLs degrade to new-tab
   * navigation — per the HTML spec, the `<a download>` attribute is only
   * honored for same-origin URLs or `blob:` / `data:` schemes; CORS does
   * not change this). Local-file URLs (`file://`) are blocked by browser
   * security policy regardless of what this method returns.
   *
   * **Return only well-formed, non-whitespace URL strings.** The library uses
   * string truthiness (`!!url`) for the `canDownload` derivation, so returning
   * `'   '` or other whitespace-only strings will enable the download button
   * but produce a broken click (browser parses whitespace-only `href` as the
   * empty URL, which resolves to the current page URL). Return `undefined`
   * (NOT an empty / whitespace-only string) when the source has no URL.
   *
   * **SSR-safety contract.** This method is called during the provider's
   * render-phase `useMemo` (the `canDownload` derivation), which runs both
   * on the server and on the client. Implementations MUST NOT touch
   * `window`, `document`, `localStorage`, `navigator`, or other browser-only
   * globals inside the method body. Reading from already-stored instance
   * fields (set during construction, where the caller is responsible for
   * SSR-safety) is the recommended pattern; see `PdfjsSource.getSourceUrl()`
   * for the canonical implementation that reads `this.url` set in the
   * constructor. (The `URL` constructor and `URL.prototype.toString` ARE
   * available in Node and are SSR-safe.)
   */
  getSourceUrl?(): string | undefined;

  /**
   * Render a page to a canvas at the given scale.
   * Returns HTMLCanvasElement (not ImageBitmap — see hard-problems #2).
   *
   * The canvas backing store dimensions should be:
   *   width = pageWidth * scale
   *   height = pageHeight * scale
   *
   * DPI scaling (devicePixelRatio) is the caller's responsibility,
   * passed via the scale parameter.
   *
   * **Contract: this method MUST return a FRESH HTMLCanvasElement per call** — NOT a
   * pooled or reused canvas instance. The print pipeline (Step 6F1) zeroes
   * `canvas.width = canvas.height = 0` after consuming the canvas, which is the only
   * reliable way to make the backing buffer GC-eligible before the next page renders.
   * Doing this on a pooled canvas would corrupt subsequent renders. Implementations
   * that want to reuse a single canvas internally should still construct + return a
   * new `HTMLCanvasElement` per call (copy the rendered bitmap if needed).
   *
   * If `signal` is provided, the implementation MUST monitor it and reject with an
   * `Error` (or `DOMException`) whose **`.name === 'AbortError'`** when the signal
   * fires during render. Consumers (specifically the print pipeline in Step 6F1)
   * use the `.name` check to silently absorb cancellation vs surface real failures —
   * a generic-Error rejection will be treated as a render failure and surfaced to
   * the user. Implementations may use `new DOMException('aborted', 'AbortError')`
   * (preferred — standard shape) OR assign `err.name = 'AbortError'` on a plain
   * Error before throwing.
   *
   * @param index - Zero-based page index
   * @param scale - Scale factor (1.0 = CSS pixels, 2.0 = retina)
   * @param signal - Optional AbortSignal to cancel in-flight renders
   */
  renderPage(
    index: number,
    scale: number,
    signal?: AbortSignal,
  ): Promise<HTMLCanvasElement>;

  /** Optional: text content for selection/search (v0.2) */
  getTextContent?(index: number): Promise<TextItem[]>;

  /** Optional: link annotations (v0.2) */
  getLinks?(index: number): Promise<LinkAnnotation[]>;

  /** Optional: document outline / table of contents (v0.2) */
  getOutline?(): Promise<OutlineItem[]>;

  /** Release all resources (PDF document, cached pages, etc.) */
  dispose(): void;
}

/** Text item with position, for the invisible text layer. */
export interface TextItem {
  text: string;
  /** X position in CSS pixels (top-left origin) */
  x: number;
  /** Y position in CSS pixels (top-left origin) */
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
}

/** Link annotation with rectangle and destination. */
export interface LinkAnnotation {
  /** Bounding rect [x1, y1, x2, y2] in CSS pixels, top-left origin */
  rect: [number, number, number, number];
  /** External URL (opens in new tab) */
  url?: string;
  /** Internal destination (navigate to page index) */
  destPage?: number;
}

/** Outline / table of contents entry. */
export interface OutlineItem {
  title: string;
  pageIndex: number;
  children?: OutlineItem[];
}
