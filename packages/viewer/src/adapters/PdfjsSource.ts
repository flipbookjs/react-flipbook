import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageSource, LinkAnnotation } from '../types/PageSource';
import { configurePdfWorker } from './configurePdfWorker';

const DEFAULT_ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
// Fence: consumers CANNOT re-enable these via additionalLinkSchemes.
const FORBIDDEN_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file']);
// RFC 3986 §3.1: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
const SCHEME_CHARS = /^[a-z0-9+.-]+$/i;
const MAX_LINKS_PER_PAGE = 1000;

function extractScheme(url: string): string | null {
  const m = url.match(/^([a-z][a-z0-9+.-]*):/i);
  return m ? m[1].toLowerCase() : null;
}

function sanitizeAdditionalSchemes(
  additional: readonly string[] | undefined,
): Set<string> {
  if (!additional?.length) return DEFAULT_ALLOWED_SCHEMES;
  const merged = new Set(DEFAULT_ALLOWED_SCHEMES);
  for (const raw of additional) {
    const s = raw.toLowerCase().trim();
    if (!SCHEME_CHARS.test(s)) continue;       // reject regex metachars, etc.
    if (FORBIDDEN_SCHEMES.has(s)) continue;    // fence
    merged.add(s);
  }
  return merged;
}

/**
 * Runtime asset URL defaults (`wasmUrl`, `standardFontDataUrl`, `cMapUrl`,
 * `iccUrl`) point at jsDelivr, version-pinned to `pdfjs.version` at runtime
 * so the consumer's installed `pdfjs-dist` peer stays authoritative. jsDelivr
 * mirrors npm; every published `pdfjs-dist` version is available and served
 * with `Cache-Control: immutable` + `Access-Control-Allow-Origin: *`.
 * Consumers who cannot fetch from a public CDN (strict CSP, air-gapped,
 * privacy-sensitive) MUST override each URL field, typically self-hosting
 * copies from their `node_modules/pdfjs-dist/{wasm,cmaps,standard_fonts,iccs}/`
 * peer install.
 */
const PDFJS_CDN_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist';

export interface PdfjsSourceOptions {
  /** Custom worker URL. If omitted, uses bundled asset URL (see configurePdfWorker). */
  workerSrc?: string;
  /** Password for protected PDFs. */
  password?: string;
  /** HTTP headers for fetching the PDF. */
  httpHeaders?: Record<string, string>;
  /** Whether to send credentials with the request. */
  withCredentials?: boolean;
  /**
   * URL where PDF.js runtime wasm binaries live (openjpeg.wasm for JPEG2000,
   * jbig2.wasm for JBIG2, qcms_bg.wasm for ICC color mgmt). If omitted,
   * defaults to jsDelivr `pdfjs-dist/wasm/` pinned to the consumer's runtime
   * `pdfjs.version` (see file-level CDN trust-surface note). MUST end with a
   * trailing slash. PDFs without JPX/JBIG2/ICC images do NOT fetch this —
   * PDF.js loads it lazily on first use.
   */
  wasmUrl?: string;
  /**
   * URL where PDF.js standard-14 font data (`.pfb`) lives. Required for correct
   * glyph rendering of Times, Helvetica, Courier, Symbol, ZapfDingbats when
   * the PDF doesn't embed these fonts. If omitted, defaults to jsDelivr
   * `pdfjs-dist/standard_fonts/` pinned to the consumer's runtime `pdfjs.version`.
   * MUST end with a trailing slash.
   */
  standardFontDataUrl?: string;
  /**
   * URL where PDF.js Adobe CMap data (`.bcmap`) lives. Required for correct
   * rendering of non-Latin scripts (CJK, Arabic, Hebrew). If omitted, defaults
   * to jsDelivr `pdfjs-dist/cmaps/` pinned to the consumer's runtime
   * `pdfjs.version`. MUST end with a trailing slash.
   */
  cMapUrl?: string;
  /**
   * Whether the CMaps at `cMapUrl` are binary-packed (`.bcmap`). pdfjs-dist
   * ships packed CMaps (and jsDelivr mirrors them as such), so the default is
   * `true`. Only set to `false` if serving text-format CMaps from a custom
   * `cMapUrl`.
   */
  cMapPacked?: boolean;
  /**
   * URL where PDF.js ICC color profile data lives. Required for correct
   * rendering of ICC color-managed images. If omitted, defaults to jsDelivr
   * `pdfjs-dist/iccs/` pinned to the consumer's runtime `pdfjs.version`.
   * MUST end with a trailing slash.
   */
  iccUrl?: string;
  /**
   * If true, `getLinks()` emits per-link console warnings for each dropped
   * annotation (reason + rect). Off by default. Useful when a consumer
   * reports that a specific link isn't clickable and you need to diagnose.
   * Dev-mode ALWAYS emits a per-call summary warn when drops > 0; this
   * option adds the per-link detail (in dev AND prod).
   */
  linkDiagnostics?: boolean;
  /**
   * Additional URL schemes accepted by `getLinks()`. Merged with the
   * default allowlist (`https:`, `http:`, `mailto:`, `tel:`). Use for
   * custom schemes (`intranet:`, `slack:`, `app:`, etc.) whose links your
   * app knows how to handle. Schemes are matched case-insensitively.
   * `javascript:`, `data:`, `vbscript:`, `file:` cannot be re-enabled
   * this way — the internal denylist is checked after the allowlist.
   */
  additionalLinkSchemes?: readonly string[];
}

export class PdfjsSource implements PageSource {
  private doc: PDFDocumentProxy | null = null;
  private pageSizes: Array<{ width: number; height: number }> = [];
  private url: string | URL | Uint8Array;
  private options: PdfjsSourceOptions;
  private initGeneration = 0;

  constructor(url: string | URL | Uint8Array, options: PdfjsSourceOptions = {}) {
    this.url = url;
    this.options = options;
  }

  async init(): Promise<void> {
    if (this.doc) throw new Error('PdfjsSource already initialized');

    const generation = ++this.initGeneration;

    configurePdfWorker(this.options.workerSrc);

    const loadingTask = pdfjs.getDocument({
      url: this.url instanceof Uint8Array ? undefined : this.url.toString(),
      data: this.url instanceof Uint8Array ? this.url : undefined,
      password: this.options.password,
      httpHeaders: this.options.httpHeaders,
      withCredentials: this.options.withCredentials,
      // Runtime asset URLs — defaults point at jsDelivr, pinned to the
      // consumer's runtime pdfjs.version. See file-level trust-surface note
      // for override guidance (offline/CSP consumers self-host).
      wasmUrl: this.options.wasmUrl ?? `${PDFJS_CDN_BASE}@${pdfjs.version}/wasm/`,
      standardFontDataUrl: this.options.standardFontDataUrl
        ?? `${PDFJS_CDN_BASE}@${pdfjs.version}/standard_fonts/`,
      cMapUrl: this.options.cMapUrl ?? `${PDFJS_CDN_BASE}@${pdfjs.version}/cmaps/`,
      cMapPacked: this.options.cMapPacked ?? true,
      iccUrl: this.options.iccUrl ?? `${PDFJS_CDN_BASE}@${pdfjs.version}/iccs/`,
    });

    const doc = await loadingTask.promise;

    // dispose() may have been called while we awaited — bail and clean up
    if (this.initGeneration !== generation) {
      doc.destroy();
      return;
    }

    const pageSizes: Array<{ width: number; height: number }> = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (this.initGeneration !== generation) {
        doc.destroy();
        return;
      }
      const viewport = page.getViewport({ scale: 1.0 });
      pageSizes.push({
        width: viewport.width,
        height: viewport.height,
      });
    }

    // Commit atomically — only after all async work succeeded for this generation
    this.doc = doc;
    this.pageSizes = pageSizes;
  }

  getPageCount(): number {
    return this.doc?.numPages ?? 0;
  }

  getPageSize(index: number): { width: number; height: number } {
    return this.pageSizes[index];
  }

  /**
   * Return the URL this source was constructed from, or `undefined` when
   * constructed from `Uint8Array` bytes. Honors the optional
   * `PageSource.getSourceUrl?()` contract.
   */
  getSourceUrl(): string | undefined {
    if (typeof this.url === 'string') return this.url;
    if (this.url instanceof URL) return this.url.toString();
    return undefined;   // Uint8Array case
  }

  async getLinks(
    index: number,
    signal?: AbortSignal,
  ): Promise<LinkAnnotation[]> {
    if (!this.doc) throw new Error('PdfjsSource not initialized');
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    // Out-of-bounds guard: transient after fast source-swap where the parent's
    // pageIndex still points at a page that doesn't exist in the new source.
    // Return [] silently — pdfjs would otherwise throw "Requested page N does
    // not exist" which our LinkOverlay's .catch swallows, but the dev warn
    // added by the outer getAnnotations try/catch would fire noisily.
    if (index < 0 || index >= this.pageSizes.length) return [];

    // Relies on pdfjs's unbounded per-document page cache — renderPage will
    // typically have called doc.getPage(index+1) a moment earlier, so this
    // is O(1). Do NOT add a local page cache; duplicating pdfjs's is worse.
    const page = await this.doc.getPage(index + 1);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    const viewport = page.getViewport({ scale: 1.0 });

    // Version-drift guard: `convertToViewportRectangle` was added to pdfjs's
    // viewport helper before v5.0. If a consumer's peer-dep resolution ever
    // lands a version missing this method, EVERY link on EVERY page drops
    // silently as `bad-rect-shape` — an unhelpful diagnostic when the actual
    // root cause is version incompatibility. Fail fast with a distinctive
    // warn instead of masquerading as data corruption.
    if (typeof viewport?.convertToViewportRectangle !== 'function') {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[flipbook] pdfjs viewport is missing convertToViewportRectangle() ` +
          `— pdfjs peer version incompatible with @flipbookjs/react-viewer ` +
          `(peer version: ${pdfjs.version}). No links rendered on page ${index}.`,
        );
      }
      return [];
    }

    let anns: any[];
    try {
      anns = await page.getAnnotations();
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[flipbook] getAnnotations() failed for page ${index}: ${err?.message}. No links rendered.`,
        );
      }
      return [];
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    const dropReasons: Record<string, number> = {};
    const noteDrop = (reason: string, ann?: any) => {
      dropReasons[reason] = (dropReasons[reason] ?? 0) + 1;
      if (this.options.linkDiagnostics) {
        console.warn(`[flipbook] link drop (${reason}) on page ${index}:`, ann);
      }
    };

    // Payload allowlist matching pdfjs's actual annotation shape (verified
    // against pdf.mjs:17595-17625). Reject any annotation carrying a
    // recognized-dangerous payload field; accept only pure {url} or {dest}.
    let linkAnns = anns.filter((a: any) => {
      if (a.subtype !== 'Link') { noteDrop('non-Link', a); return false; }
      if (a.actions) { noteDrop('actions-js-bundle', a); return false; }
      if (a.action != null) {
        // Reject ANY non-null action payload — string (Named), object, or
        // otherwise. pdfjs primarily surfaces Named actions as strings but the
        // security boundary must be shape-agnostic: an unexpected non-string
        // shape must not slip past.
        const label = typeof a.action === 'string' ? a.action : typeof a.action;
        noteDrop(`action:${label}`, a); return false;
      }
      if (a.attachment) { noteDrop('attachment', a); return false; }
      if (a.setOCGState) { noteDrop('setOCGState', a); return false; }
      if (a.resetForm) { noteDrop('resetForm', a); return false; }
      return true;
    });

    if (linkAnns.length > MAX_LINKS_PER_PAGE) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[flipbook] page ${index} has ${linkAnns.length} links; capping at ${MAX_LINKS_PER_PAGE}.`,
        );
      }
      linkAnns = linkAnns.slice(0, MAX_LINKS_PER_PAGE);
    }

    const allowedSchemes = sanitizeAdditionalSchemes(this.options.additionalLinkSchemes);
    const converted = await Promise.all(
      linkAnns.map((a: any) => this.convertLink(a, viewport, allowedSchemes, signal, noteDrop)),
    );

    const links = converted.filter((l): l is LinkAnnotation => l !== null);

    if (process.env.NODE_ENV !== 'production') {
      const totalDrops = Object.values(dropReasons).reduce((a, b) => a + b, 0);
      if (totalDrops > 0) {
        const summary = Object.entries(dropReasons)
          .map(([r, n]) => `${n}×${r}`).join(', ');
        console.warn(
          `[flipbook] getLinks(page ${index}): ${totalDrops} annotation(s) dropped (${summary}). Set PdfjsSourceOptions.linkDiagnostics=true for per-link detail.`,
        );
      }
    }

    return links;
  }

  private async convertLink(
    ann: any,
    viewport: any,
    allowedSchemes: Set<string>,
    signal: AbortSignal | undefined,
    noteDrop: (reason: string, ann?: any) => void,
  ): Promise<LinkAnnotation | null> {
    try {
      const raw = viewport.convertToViewportRectangle(ann.rect);
      if (!Array.isArray(raw) || raw.length < 4) {
        noteDrop('bad-rect-shape', ann); return null;
      }
      const [x1, y1, x2, y2] = raw;
      if (![x1, y1, x2, y2].every(Number.isFinite)) {
        noteDrop('rect-non-finite', ann); return null;
      }
      const rect: [number, number, number, number] = [
        Math.min(x1, x2), Math.min(y1, y2),
        Math.max(x1, x2), Math.max(y1, y2),
      ];
      if (rect[2] <= rect[0] || rect[3] <= rect[1]) {
        noteDrop('rect-zero-area', ann); return null;
      }

      if (ann.url) {
        const url = ann.url.trim();
        const scheme = extractScheme(url);
        // Load-bearing: parse scheme literally, never build a regex from
        // consumer input. FORBIDDEN first (fence), ALLOWED second (decision).
        if (!scheme) { noteDrop('no-scheme', ann); return null; }
        if (FORBIDDEN_SCHEMES.has(scheme)) { noteDrop(`forbidden-scheme:${scheme}`, ann); return null; }
        if (!allowedSchemes.has(scheme)) { noteDrop(`scheme-not-allowed:${scheme}`, ann); return null; }
        return { rect, url };
      }
      if (ann.dest == null) { noteDrop('no-dest', ann); return null; }

      const dest = typeof ann.dest === 'string'
        ? await this.doc!.getDestination(ann.dest)
        : ann.dest;
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (!Array.isArray(dest) || dest.length === 0) {
        noteDrop('dest-unresolved', ann); return null;
      }

      const destPage = await this.doc!.getPageIndex(dest[0]);
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      // Symmetric with rect validation: pdfjs's getPageIndex can return NaN or
      // Infinity on malformed page refs (technically `typeof number` but not
      // renderable). LinkOverlay's normalizer catches these downstream via
      // `Number.isInteger`, but recording the drop reason here preserves
      // diagnostic parity with other filter sites — otherwise a `linkDiagnostics:
      // true` consumer sees a link that isn't rendered with no matching drop
      // reason in the log.
      if (typeof destPage !== 'number' || !Number.isFinite(destPage) || destPage < 0) {
        noteDrop('dest-invalid-number', ann); return null;
      }
      return { rect, destPage };
    } catch (err: any) {
      // Propagate aborts; drop everything else.
      if (err?.name === 'AbortError') throw err;
      noteDrop('exception', ann);
      return null;
    }
  }

  async renderPage(
    index: number,
    scale: number,
    signal?: AbortSignal,
  ): Promise<HTMLCanvasElement> {
    if (!this.doc) throw new Error('PdfjsSource not initialized');
    if (!(scale > 0)) throw new Error(`Invalid scale: ${scale}`); // catches 0, negative, NaN

    // Check abort before expensive async work
    if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');

    // Limit concurrent renders to prevent OOM on mobile (architecture review #6)
    await this.acquireRenderSlot(signal);

    try {

    const page = await this.doc.getPage(index + 1); // pdfjs is 1-indexed

    // Check abort after getPage (may have been cancelled during await)
    if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');

    // Canvas size guard (hard-problem #8)
    // If the requested scale would exceed the max canvas area,
    // render at a reduced scale. The caller handles CSS scaling.
    const MAX_CANVAS_SIZE = 4096 * 4096;
    const rawViewport = page.getViewport({ scale });
    const pageWidth = rawViewport.width / scale;
    const pageHeight = rawViewport.height / scale;
    const maxScale = Math.sqrt(MAX_CANVAS_SIZE / (pageWidth * pageHeight));
    const effectiveScale = Math.min(scale, maxScale);
    const viewport = effectiveScale < scale
      ? page.getViewport({ scale: effectiveScale })
      : rawViewport;

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    // If effectiveScale < scale, the backing store is smaller than requested.
    // The caller (PageRenderer) sets CSS width/height to the intended size,
    // so the browser stretches the smaller canvas to fill — a soft upscale.
    // No transform or dataset marker needed.

    // pdfjs v5 takes the canvas directly (not canvasContext).
    // It calls getContext('2d') internally.
    // We still check getContext ourselves to catch OOM before pdfjs tries.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      canvas.width = 0;
      canvas.height = 0;
      throw new Error('Canvas context creation failed (memory limit exceeded?)');
    }

    const renderTask = page.render({ canvas, viewport });

    // Map AbortSignal to pdfjs cancel
    const onAbort = () => renderTask.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await renderTask.promise;
    } catch (err: any) {
      if (err?.name === 'RenderingCancelledException') {
        throw new DOMException('Render cancelled', 'AbortError');
      }
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    return canvas;

    } finally {
      this.releaseRenderSlot();
    }
  }

  dispose(): void {
    this.initGeneration++; // invalidate any in-flight init
    this.doc?.destroy();
    this.doc = null;
    this.pageSizes = [];
    // Fail loud: reject any queued renders (Rule 1 — no hanging promises)
    const queue = this.renderQueue;
    this.renderQueue = [];
    this.activeRenders = 0;
    const disposedError = new Error('PdfjsSource disposed while render was queued');
    for (const entry of queue) {
      entry.reject(disposedError);
    }
  }

  // --- Concurrency limiter (architecture review #6) ---
  // Limits concurrent renderPage calls to prevent OOM on mobile
  // when the virtualizer triggers 6-10 page renders at once.
  private activeRenders = 0;
  private readonly maxConcurrentRenders = 3;
  private renderQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  private async acquireRenderSlot(signal?: AbortSignal): Promise<void> {
    if (this.activeRenders < this.maxConcurrentRenders) {
      this.activeRenders++;
      return;
    }
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: () => { this.activeRenders++; resolve(); },
        reject,
      };
      this.renderQueue.push(entry);
      signal?.addEventListener('abort', () => {
        const idx = this.renderQueue.indexOf(entry);
        if (idx >= 0) this.renderQueue.splice(idx, 1);
        reject(new DOMException('Render cancelled', 'AbortError'));
      }, { once: true });
    });
  }

  private releaseRenderSlot(): void {
    this.activeRenders--;
    const next = this.renderQueue.shift();
    next?.resolve();
  }
}
