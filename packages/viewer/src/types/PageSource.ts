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
