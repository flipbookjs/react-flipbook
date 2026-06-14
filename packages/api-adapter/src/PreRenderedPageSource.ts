// @flipbookjs/api-adapter — image-tier PageSource implementation per the
// locked artifact contract (see step-6.5-artifact-contract-spec.md).

import type {
  PageSource,
  TextItem,
  LinkAnnotation,
  OutlineItem,
} from '@flipbookjs/react-viewer';
import { validateManifest } from './validateManifest';

// Mirrors PdfjsSource.ts:114 canvas-area guard. Mobile Safari and some older
// Android browsers have a max canvas backing-store area; exceeding it produces
// blank or downscaled output silently.
const MAX_CANVAS_SIZE = 4096 * 4096;

// Default timeout for the manifest fetch inside init(). Per house-rules
// Rule 2 ("every state needs an exit"), init() MUST have a fallback path
// if the bundle host hangs the fetch — operator-side CDN timeouts aren't
// guaranteed. 30 s is generous for a small manifest.json over a slow link
// and tight enough that a hung CDN fails fast on dev/test. Not a public
// option in 1.0.0 (per D9's narrow shape); future-additive `initTimeoutMs?`
// reserved in plan §7 if a real caller needs override.
const INIT_TIMEOUT_MS = 30_000;

export interface Manifest {
  manifestVersion: 1;
  documentId: string;
  contentHash: string;
  status: 'ready' | 'pending' | 'failed';
  generatedAt: string;
  pageCount: number;
  defaults: {
    widths: number[];
    format: 'webp';
    tierUrlTemplate: string;
    sidecarUrlTemplate: string;
    pageNumberDigits: number;
  };
  pages: Array<{ size: [number, number]; rotation: 0 | 90 | 180 | 270; label?: string }>;
  documentArtifacts: {
    outline: string;
    search?: string;
    seo?: string;
    accessibilityReport?: string;
    sourcePdf?: string;
  };
  overrides?: Record<string, Partial<{ widths: number[]; tierUrls: Record<number, string> }>>;
}

export interface PreRenderedPageSourceOptions {
  /** URL to the bundle root (where `manifest.json` lives). String or URL. */
  bundleUrl: string | URL;
  /** Forwarded to every fetch() the adapter makes. Default `'same-origin'`. */
  credentials?: RequestCredentials;
}

export class PreRenderedPageSource implements PageSource {
  private bundleUrl: string;
  private credentials: RequestCredentials;
  private manifest: Manifest | null = null;
  private disposed = false;

  constructor(options: PreRenderedPageSourceOptions) {
    // Normalize bundleUrl: accept string | URL, strip trailing slashes so
    // concatenation with sub-paths is unambiguous. We deliberately do NOT
    // pass the input through `new URL(...)` — that would reject relative
    // inputs like '/fixtures/doc_smoke_3pg' (used by the demo). String
    // concatenation handles both forms.
    const raw = typeof options.bundleUrl === 'string'
      ? options.bundleUrl
      : options.bundleUrl.toString();
    // Strip ALL trailing slashes (not just one) so `https://cdn.example//`
    // normalizes to `https://cdn.example` cleanly; subsequent concatenation
    // produces correct URLs with a single separator slash.
    this.bundleUrl = raw.replace(/\/+$/, '');
    this.credentials = options.credentials ?? 'same-origin';
  }

  async init(): Promise<void> {
    // Race the manifest fetch against INIT_TIMEOUT_MS so a hung CDN can't
    // park the adapter in a permanent loading state (house-rules Rule 2).
    // The race rejection bypasses the disposed check below — that's fine:
    // a timeout-induced rejection is the same shape as any other init
    // failure (descriptive Error, propagated to usePageSource's .catch
    // which is gated by its own disposed flag).
    const timeoutHandle: { id: ReturnType<typeof setTimeout> | null } = { id: null };
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle.id = setTimeout(
        () => reject(new Error(`Manifest fetch timeout after ${INIT_TIMEOUT_MS}ms for ${this.bundleUrl}/manifest.json`)),
        INIT_TIMEOUT_MS,
      );
    });
    const manifestUrl = `${this.bundleUrl}/manifest.json`;
    let res: Response;
    try {
      res = await Promise.race([this.fetchBundle('manifest.json'), timeoutPromise]);
    } finally {
      if (timeoutHandle.id !== null) clearTimeout(timeoutHandle.id);
    }
    if (!res.ok) {
      throw new Error(`Failed to load manifest at ${manifestUrl}: ${res.status} ${res.statusText}`);
    }
    if (this.disposed) throw new DOMException('aborted', 'AbortError');
    let raw: unknown;
    try {
      raw = await res.json();
    } catch (e) {
      // Catches the "CDN returned 200 + HTML" case where the response is
      // syntactically not JSON. Plain SyntaxError is unhelpful; wrap.
      throw new Error(`Manifest at ${manifestUrl} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (this.disposed) throw new DOMException('aborted', 'AbortError');
    // Per D14: structural validation + URL safety. Returns the typed manifest
    // or throws a descriptive Error. Enforces uniform page size + rotation per
    // D13. After this point the adapter body assumes structural integrity.
    const manifest = validateManifest(raw, this.bundleUrl);
    if (manifest.status !== 'ready') {
      throw new Error(`Document not ready: ${manifest.status}`);
    }
    this.manifest = manifest;
  }

  getPageCount(): number {
    this.requireInit();
    return this.manifest!.pageCount;
  }

  getPageSize(index: number): { width: number; height: number } {
    this.requireInit();
    // API-boundary bounds check (viewer → adapter). The validator
    // guarantees pages.length === pageCount; this check protects against
    // a viewer bug that passes an out-of-range index. Per house-rules
    // Rule 3 + Rule 1: validate at API boundaries, throw with descriptive
    // error rather than the cryptic "Cannot read properties of undefined".
    const { pageCount } = this.manifest!;
    if (index < 0 || index >= pageCount) {
      throw new RangeError(`Page index ${index} out of range [0, ${pageCount})`);
    }
    const [width, height] = this.manifest!.pages[index].size;
    return { width, height };
  }

  getSourceUrl(): string | undefined {
    // Per D11: resolved against bundle root when present; undefined otherwise.
    // Bundles without a source PDF disable the built-in <DownloadButton>.
    //
    // sourcePdf is either an absolute http(s):// URL (per D14 Part 2) or a
    // relative bundle path. We deliberately avoid `new URL(ref, bundleUrl)`
    // here: when bundleUrl is itself relative (e.g., '/fixtures/doc_smoke_3pg'
    // as in the Phase 4 demo), the URL constructor throws because its base
    // argument must be absolute. String concatenation matches the rest of
    // the adapter's URL builders (pickTier, buildSidecarUrl, fetchBundle)
    // and works for both absolute and relative bundleUrl forms.
    //
    // The `^https?:\/\/` regex matches D14 Part 2's allowed scheme list;
    // case-insensitive flag is essential because browser URL schemes are
    // case-insensitive (`HTTPS://` is identical to `https://`). At this
    // point validateManifest() (D14) has already enforced both schemes
    // and host policy; this runtime check is purely the absolute-vs-
    // relative discriminator.
    const ref = this.manifest?.documentArtifacts?.sourcePdf;
    if (!ref) return undefined;
    return /^https?:\/\//i.test(ref) ? ref : `${this.bundleUrl}/${ref}`;
  }

  async renderPage(index: number, scale: number, signal?: AbortSignal): Promise<HTMLCanvasElement> {
    this.requireInit();
    // API-boundary bounds check — same rationale as getPageSize.
    const { pageCount } = this.manifest!;
    if (index < 0 || index >= pageCount) {
      throw new RangeError(`Page index ${index} out of range [0, ${pageCount})`);
    }
    // API-boundary scale validation. Bogus values (NaN, Infinity, 0, negative)
    // would silently produce a 0×0 canvas (or worse, a NaN-dimension canvas
    // that browsers clamp to 0). Per house-rules Rule 1, fail loud at the
    // API boundary with a descriptive RangeError rather than returning a
    // canvas the viewer can't render.
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new RangeError(`renderPage scale must be a positive finite number; got ${scale}`);
    }
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    // Concurrency limiter, mirroring PdfjsSource.ts:182-212 (architecture
    // review #6). The viewer's virtualizer fires 6-10 renderPage calls in
    // parallel when a multi-page spread enters view; the image adapter
    // allocates a Blob + ImageBitmap + a fresh canvas backing store per
    // call, so unbounded concurrency reproduces the same mobile-Safari OOM
    // path the pdf.js adapter already solved. Cap at 3 in-flight renders;
    // remainder wait in a FIFO queue. dispose() flushes the queue (fail-loud
    // — Rule 1 from the architecture doc). The slot must be released on
    // every path (success, throw, abort), so the body is wrapped in a
    // try/finally.
    await this.acquireRenderSlot(signal);
    try {
      const { width: pageWidth, height: pageHeight } = this.getPageSize(index);
      // PageSource contract: `scale` already incorporates DPR (1.0 = CSS, 2.0 =
      // retina). Caller side does `scale * dpr` BEFORE calling renderPage (see
      // ThumbnailCanvas.tsx for the canonical pattern). Tier selection uses the
      // pageWidth * scale product directly — no additional DPR multiplication.
      const targetWidth = pageWidth * scale;

      const tierUrl = this.pickTier(index, targetWidth);
      const imageRes = await fetch(tierUrl, { signal, credentials: this.credentials });
      if (!imageRes.ok) {
        throw new Error(`Failed to load tier ${tierUrl}: ${imageRes.status} ${imageRes.statusText}`);
      }
      const blob = await imageRes.blob();
      // createImageBitmap options — specified explicitly to fix cross-browser
      // behavior. Chrome 102+ changed `imageOrientation` default from 'none'
      // to 'from-image'; the bake step (Step 7 Rust converter) emits WebPs
      // without rotation EXIF, so `'none'` is correct and matches the older
      // implicit default. `premultiplyAlpha` / `colorSpaceConversion` are
      // pinned to their spec defaults but written out so a future
      // browser-default shift doesn't silently change rendering.
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'none',
        premultiplyAlpha: 'default',
        colorSpaceConversion: 'default',
      });

      if (signal?.aborted) {
        bitmap.close();
        throw new DOMException('aborted', 'AbortError');
      }

      // Canvas-area guard, mirroring PdfjsSource.ts:114 (hard-problem #8).
      // Mobile Safari and some Android browsers silently produce blank canvases
      // when the backing store exceeds the platform's max-canvas-area. We clamp
      // the rasterization scale; the browser CSS-upscales the smaller canvas to
      // the requested display size (soft upscale — same pattern as PdfjsSource).
      const maxScale = Math.sqrt(MAX_CANVAS_SIZE / (pageWidth * pageHeight));
      const effectiveScale = Math.min(scale, maxScale);

      // PageSource contract: FRESH HTMLCanvasElement per call. Backing-store
      // sized at `pageSize * effectiveScale` (DPR already in scale; effectiveScale
      // applies the area clamp).
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(pageWidth * effectiveScale);
      canvas.height = Math.floor(pageHeight * effectiveScale);
      // `alpha: false` — matches PdfjsSource.ts:136. Page rasterization output
      // is always opaque (no per-pixel alpha needed), so opting out lets the
      // browser drop the alpha channel from the backing store. Net effect on
      // most browsers: backing-store memory drops by 25% (4 bytes RGBA → 3
      // bytes RGB packed), which compounds with the concurrency limiter's
      // worst-case memory budget.
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        canvas.width = 0;
        canvas.height = 0;
        bitmap.close();
        throw new Error('Canvas context creation failed (memory limit exceeded?)');
      }
      // Bitmap cleanup MUST happen on every exit path — including
      // drawImage throws (rare but real: INVALID_STATE_ERR if the bitmap
      // is concurrently closed, iOS Safari OOM during IOSurface allocation,
      // malformed source). Outer try/finally releases the slot; this inner
      // one ensures the bitmap is closed even if drawImage throws. Per
      // house-rules Rule 6 (every side effect reversed in every exit path).
      try {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } finally {
        bitmap.close();
      }
      return canvas;
    } finally {
      this.releaseRenderSlot();
    }
  }

  async getTextContent(index: number): Promise<TextItem[]> {
    this.requireInit();
    const url = this.buildSidecarUrl(index, 'text');
    const res = await fetch(url, { credentials: this.credentials });
    // 404 = legitimate absence (page has no text); empty array is the right
    // graceful-degradation signal. 5xx / network errors = server problem;
    // fail loud so operators see it. Per house-rules Rule 1 + D8's
    // failure-model split.
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new Error(`Sidecar fetch failed (${res.status} ${res.statusText}) for ${url}`);
    }
    const { items } = (await res.json()) as { items: TextItem[] };
    return items;
  }

  async getLinks(index: number): Promise<LinkAnnotation[]> {
    this.requireInit();
    const url = this.buildSidecarUrl(index, 'links');
    const res = await fetch(url, { credentials: this.credentials });
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new Error(`Sidecar fetch failed (${res.status} ${res.statusText}) for ${url}`);
    }
    const { links } = (await res.json()) as { links: LinkAnnotation[] };
    return links;
  }

  async getOutline(): Promise<OutlineItem[]> {
    this.requireInit();
    const url = `${this.bundleUrl}/${this.manifest!.documentArtifacts.outline}`;
    const res = await fetch(url, { credentials: this.credentials });
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new Error(`Outline fetch failed (${res.status} ${res.statusText}) for ${url}`);
    }
    const { items } = (await res.json()) as { items: OutlineItem[] };
    return items;
  }

  dispose(): void {
    this.disposed = true;
    this.manifest = null;
    // Flush the render queue — reject pending acquireRenderSlot() promises
    // so callers waiting on a slot don't hang forever. Matches the fail-loud
    // dispose path at PdfjsSource.ts:172-179.
    const queue = this.renderQueue;
    this.renderQueue = [];
    this.activeRenders = 0;
    const disposedError = new Error('PreRenderedPageSource disposed while render was queued');
    for (const entry of queue) entry.reject(disposedError);
  }

  // ---- concurrency limiter (mirrors PdfjsSource.ts:182-212) ----

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

  // ---- private helpers ----

  /** Wrapper around fetch() for bundle assets fetched inside init() — sets
   *  credentials. signal is intentionally omitted (PageSource.init has no
   *  signal param; cancellation is handled via the post-await disposed check). */
  private fetchBundle(path: string): Promise<Response> {
    return fetch(`${this.bundleUrl}/${path}`, { credentials: this.credentials });
  }

  private requireInit(): void {
    if (this.disposed) throw new Error('PreRenderedPageSource has been disposed');
    if (!this.manifest) throw new Error('PreRenderedPageSource not initialized');
  }

  private pickTier(index: number, requestedWidth: number): string {
    const manifest = this.manifest!;
    const override = manifest.overrides?.[this.pageId(index)];
    // `widths` is guaranteed sorted-unique-positive by validateManifest
    // (D14 Part 3). Per house-rules Rule 3, we trust the validator and
    // don't re-sort here. find() walks in declaration order, which is
    // already ascending.
    const widths = override?.widths ?? manifest.defaults.widths;
    const picked = widths.find((w) => w >= requestedWidth) ?? widths[widths.length - 1];
    const tierUrls = override?.tierUrls;
    if (tierUrls && tierUrls[picked]) {
      return `${this.bundleUrl}/${tierUrls[picked]}`;
    }
    const path = manifest.defaults.tierUrlTemplate
      .replace('{page}', this.pageId(index))
      .replace('{width}', String(picked))
      .replace('{format}', manifest.defaults.format);
    return `${this.bundleUrl}/${path}`;
  }

  private buildSidecarUrl(index: number, sidecar: string): string {
    const manifest = this.manifest!;
    const path = manifest.defaults.sidecarUrlTemplate
      .replace('{page}', this.pageId(index))
      .replace('{sidecar}', sidecar);
    return `${this.bundleUrl}/${path}`;
  }

  private pageId(index: number): string {
    return String(index + 1).padStart(this.manifest!.defaults.pageNumberDigits, '0');
  }
}
