import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageSource } from '../types/PageSource';
import { configurePdfWorker } from './configurePdfWorker';

export interface PdfjsSourceOptions {
  /** Custom worker URL. If omitted, uses bundled asset URL (see configurePdfWorker). */
  workerSrc?: string;
  /** Password for protected PDFs. */
  password?: string;
  /** HTTP headers for fetching the PDF. */
  httpHeaders?: Record<string, string>;
  /** Whether to send credentials with the request. */
  withCredentials?: boolean;
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
