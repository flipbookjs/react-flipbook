// @flipbookjs/api-adapter — image-tier PageSource implementation per the
// locked artifact contract (see step-6.5-artifact-contract-spec.md).

import type {
  PageSource,
  TextItem,
  LinkAnnotation,
  OutlineItem,
} from '@flipbookjs/react-viewer';
import { validateManifest } from './validateManifest';
import { tokenizeQuery } from './tokenizeQuery';

// ============================================================
// Step 8a Phase G — search index public types
// ============================================================

/** Inner index shape per Phase D winner (inverted). */
export type InvertedIndex = Record<string, Array<[number, number]>>;
/**
 * Historical sibling shape; preserved in the type surface so a future v1.x
 * format swap doesn't require a major bump. The current adapter only reads
 * `InvertedIndex` — see `EXPECTED_FORMAT` below.
 */
export type SortedPositionalIndex = Array<[string, number, number]>;

/**
 * Locked envelope shape per Step 8a Phase C. Both candidate index formats
 * (inverted vs sorted-positional) are wrapped in this envelope so:
 *   1. `errors[]` has a safe slot regardless of the inner format
 *   2. `format` is the source of truth for the shape-detection guard
 *   3. `stats` carries operational metadata for the audit trail
 */
export interface SearchIndexEnvelope {
  format: 'inverted' | 'sorted';
  serializationVersion: 1;
  index: InvertedIndex | SortedPositionalIndex;
  errors: Array<{
    page_index: number;
    code: 'extraction_timeout' | 'resource_limit_exceeded' | string;
    message: string;
  }>;
  stats: {
    token_count: number;
    page_count: number;
    errored_page_count: number;
  };
}

export interface SearchOptions {
  /** Cap-at-page-boundary semantics; default 100. */
  maxResults?: number;
  /**
   * `searchTerm` is the heaviest accessor (1 search.json fetch + up to N
   * parallel text.json fetches via Promise.all) — mirrors the existing
   * `renderPage(index, scale, signal?)` precedent. Threaded to every fetch;
   * on abort the promise rejects with `AbortError`.
   */
  signal?: AbortSignal;
}

export interface SearchHit {
  pageIndex: number;
  itemIndex: number;
  matchedToken: string;
  /**
   * PLAIN TEXT — do NOT pass to innerHTML, dangerouslySetInnerHTML,
   * document.write, or any HTML-interpolating sink. Use textContent /
   * React `{child}` / equivalent.
   *
   * The adapter's `buildSnippet` strips HTML-active chars (`<>&'"\``) as
   * defense in depth — even if a malicious PDF embeds `<script>` in its
   * text layer, the snippet rendered to consumers is harmless. Consumers
   * are still responsible for treating this field as untrusted text
   * content. Defense in depth, not defense in sufficiency.
   */
  contextSnippet: string;
}

// Compile-time hardcoded — set during Phase D when the winner is chosen. The
// adapter NEVER tries to parse both formats; the envelope's `format` field is
// the source of truth and a mismatch fails loud.
const EXPECTED_FORMAT: 'inverted' | 'sorted' = 'inverted';
const EXPECTED_SERIALIZATION_VERSION = 1;
const DEFAULT_MAX_RESULTS = 100;
const QUERY_LENGTH_CAP = 1024;
const LEGACY_SEARCH_HITS: SearchHit[] = [];

// Snippet windowing + sanitization constants (see `buildSnippet`).
const SNIPPET_WINDOW_BEFORE = 20;
const SNIPPET_WINDOW_AFTER = 30;
const SNIPPET_MAX_CHARS = 50;
const HTML_ACTIVE_CHARS_RE = /[<>&'"`]/g;
const TRIM_PARTIAL_WORD_LEAD = /^\S+\s/;
const TRIM_PARTIAL_WORD_TAIL = /\s\S+$/;

// ============================================================
// Step 8b Phase B — reading-order types, consts, and options.
// Per step-8b-reading-order.md §5. Mirrors 8a's typed-envelope
// pattern (EXPECTED_* version constant, LEGACY_* graceful-
// degradation default, exported options interface).
// ============================================================

/**
 * Known block kinds. OPEN UNION: future v1.x sidecars may include additional
 * kind values without bumping `serializationVersion`. Consumer code MUST
 * handle unknown kinds gracefully — render with paragraph semantics by default.
 * The `string & {}` intersection preserves autocomplete on the known values
 * while accepting any string at runtime.
 */
export type ReadingOrderBlockKind =
  | 'paragraph'
  | 'heading'
  | 'caption'
  | 'aside'
  | (string & {});

export type ReadingOrderSource = 'passthrough' | 'structtree' | 'heuristic';

export interface ReadingOrderBlock {
  kind: ReadingOrderBlockKind;
  /**
   * Compact contiguous-range form: `[startInclusive, endExclusive]`. Used by
   * v1 passthrough (always) and future StructTree/heuristic blocks whose
   * referenced items happen to be contiguous (the common case). Mutually
   * exclusive with `items`.
   */
  itemRange?: [number, number];
  /**
   * Sparse form for blocks whose items are non-contiguous. Future StructTree
   * walker uses this for marked-content sequences that interleave with other
   * content. Mutually exclusive with `itemRange`. v1 passthrough NEVER emits.
   */
  items?: number[];
  rect: [number, number, number, number];
}

export interface ReadingOrder {
  serializationVersion: 1;
  source: ReadingOrderSource;
  blocks: ReadingOrderBlock[];
  order: number[];
  errors: Array<{ code: string; message: string }>;
}

const LEGACY_READING_ORDER: ReadingOrder = {
  serializationVersion: 1,
  source: 'passthrough',
  blocks: [],
  order: [],
  errors: [],
};

const EXPECTED_READING_ORDER_SERIALIZATION_VERSION = 1;
// Coexistence note: 8a defined `EXPECTED_SERIALIZATION_VERSION = 1`
// (PreRenderedPageSource.ts:83), which is search-specific by context but
// generically named. 8b deliberately introduces the fully-qualified
// `EXPECTED_READING_ORDER_SERIALIZATION_VERSION` rather than reusing or
// renaming the 8a constant — they version independently (each envelope
// bumps its own `serializationVersion` on shape change). Future passes
// (8b.1 StructTree, 8b.2 heuristic, 8c accessibility-report) follow this
// `EXPECTED_<SLICE>_SERIALIZATION_VERSION` naming. Per Rule 5 we do NOT
// rename the 8a constant for harmony — that's "while we're at it" cleanup.

// Named options interface — mirrors 8a's `SearchOptions` (PreRenderedPageSource.ts:49)
// so consumers can `import type { ReadingOrderOptions }` and pre-declare typed
// option objects. v1 only has `signal`; future additive options (e.g., a
// `blockKindsFilter` for screen-reader UX) land here without breaking the
// signature.
export interface ReadingOrderOptions {
  /**
   * Threaded to the underlying fetch; on abort the promise rejects with
   * `AbortError`. Mirrors the established `searchTerm({ signal })` precedent.
   */
  signal?: AbortSignal;
}

// ============================================================
// Step 8c Phase B — accessibility types (§5.1) + LEGACY constants
// (§5.2) + EXPECTED_* version pins. Reading-order coexistence: each
// envelope versions independently per the
// `EXPECTED_<SLICE>_SERIALIZATION_VERSION` naming established by 8b.
// ============================================================

/**
 * Provenance of an extracted accessibility item. OPEN UNION — known values
 * are `structtree | heuristic | manual`; future producers MAY emit additional
 * values (e.g., `mcid-derived` from 8c.1, `ai-suggested` from a future LLM
 * pipeline) without bumping `serializationVersion`. Adapter validator
 * accepts any non-empty string. Consumer UIs SHOULD treat unknown values as
 * "unspecified provenance" rather than throwing. Diverges from 8b's CLOSED
 * `ReadingOrderSource` enum because 8c's `source` is INFORMATIONAL (Step 16
 * UI label), not SEMANTIC (consumer decision-making).
 */
export type AccessibilitySource =
  | 'structtree'
  | 'heuristic'
  | 'manual'
  | (string & {});

export type RemediationStatus = 'needsReview' | 'verified' | 'modified';

export interface AccessibilityRegion {
  id: string;
  /** Layout-region kind. OPEN UNION — v1 producer never emits this surface
   *  (regions[] is always `[]`), but 8c.1's heuristic emission and Step 16's
   *  manual overlays may surface entries through the same validator. */
  kind: 'header' | 'main' | 'footer' | 'sidebar' | (string & {});
  rect: [number, number, number, number];
  source: AccessibilitySource;
  /** SHA-1 hex prefix (16 lowercase hex chars) per producer §3.2 migration-key
   *  contract. Adapter validates structural shape only — does NOT recompute
   *  the hash. */
  fingerprint: string;
}

export interface AccessibilityHeading {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** /ActualText if present, else "" (Step 16 spatial-joins against text.json
   *  to fill empties per producer §1 honesty discipline). */
  text: string;
  rect: [number, number, number, number];
  source: AccessibilitySource;
  fingerprint: string;
}

export interface AccessibilityAltText {
  id: string;
  imageRect: [number, number, number, number];
  text: string;
  source: AccessibilitySource;
  fingerprint: string;
}

/**
 * Operator-observability counters surfaced on the doc-level report. Wire
 * keys are deliberately snake_case (per producer §2.2 lock) — they match
 * the metric-system + tracing-event naming. The OUTER report envelope
 * stays camelCase; only these counter sub-objects diverge.
 */
export interface ExtractorDiagnostics {
  headings: {
    seen: number;
    skipped_missing_bbox: number;
    emitted: number;
    emitted_with_text: number;
  };
  figures: {
    seen: number;
    skipped_missing_bbox: number;
    skipped_missing_alt: number;
    emitted_with_alt: number;
  };
  images: {
    enumerated: number;
    matched_to_figure: number;
    unmatched: number;
  };
}

export interface PageAccessibility {
  serializationVersion: 1;
  pageLabel: string | null;
  lang: string | null;
  remediationStatus: RemediationStatus;
  regions: AccessibilityRegion[];
  headings: AccessibilityHeading[];
  altText: AccessibilityAltText[];
  errors: Array<{ feature: string; code: string; message: string }>;
}

export interface AccessibilityReport {
  serializationVersion: 1;
  /** `bool` from producer (`FPDFCatalog_IsTagged`); `null` only in
   *  `LEGACY_ACCESSIBILITY_REPORT` (legacy `{}`-placeholder bundles where
   *  the producer never measured). */
  tagged: boolean | null;
  lang: string | null;
  structure: { score: number | null; source: AccessibilitySource | null };
  headings: {
    score: number | null;
    source: AccessibilitySource | null;
    extracted: number;
    missing: number | null;
  };
  altText: {
    score: number | null;
    source: AccessibilitySource | null;
    extracted: number;
    missing: number;
    imageCount: number;
  };
  readingOrder: {
    score: number | null;
    source: 'passthrough' | 'structtree' | 'heuristic';
  };
  errors: Array<{ feature: string; code: string; message: string }>;
  extractorDiagnostics: ExtractorDiagnostics;
}

export interface AccessibilityOptions {
  signal?: AbortSignal;
}

const LEGACY_PAGE_ACCESSIBILITY: PageAccessibility = {
  serializationVersion: 1,
  pageLabel: null,
  lang: null,
  remediationStatus: 'needsReview',
  regions: [],
  headings: [],
  altText: [],
  errors: [],
};

const LEGACY_ACCESSIBILITY_REPORT: AccessibilityReport = {
  serializationVersion: 1,
  tagged: null,
  lang: null,
  structure: { score: null, source: null },
  headings: { score: null, source: null, extracted: 0, missing: null },
  altText: { score: null, source: null, extracted: 0, missing: 0, imageCount: 0 },
  readingOrder: { score: null, source: 'passthrough' },
  errors: [],
  extractorDiagnostics: {
    headings: { seen: 0, skipped_missing_bbox: 0, emitted: 0, emitted_with_text: 0 },
    figures: { seen: 0, skipped_missing_bbox: 0, skipped_missing_alt: 0, emitted_with_alt: 0 },
    images: { enumerated: 0, matched_to_figure: 0, unmatched: 0 },
  },
};

const EXPECTED_PAGE_ACCESSIBILITY_SERIALIZATION_VERSION = 1;
const EXPECTED_ACCESSIBILITY_REPORT_SERIALIZATION_VERSION = 1;

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
  converterVersion?: string;
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

  // ============================================================
  // Step 8b Phase B — getReadingOrder()
  // ============================================================

  /**
   * Read the reading-order sidecar for `pageIndex`. v1 producer emits
   * `source: "passthrough"` with one paragraph block per page containing
   * all text.json items in PDFium's natural extraction order; consumer
   * code MUST treat that as a structural placeholder, NOT as a "real"
   * reading-order claim. The `source` field is the load-bearing honesty
   * signal — future producers (StructTree walker, heuristic port) will
   * upgrade some pages to `"structtree"` / `"heuristic"`, and consumer
   * UX can detect that via `source` and adapt.
   *
   * Legacy bundles (404 or `{}` placeholder) return `LEGACY_READING_ORDER`
   * — empty arrays with the same envelope shape so consumer code doesn't
   * need to branch on existence.
   *
   * Shape failures (wrong `serializationVersion`, unknown `source`,
   * malformed block selector, out-of-range `order` index, non-finite
   * rect, etc.) throw with a diagnostic message naming the URL and the
   * offending field. The error pattern mirrors 8a's `searchTerm`.
   *
   * `options.signal` is threaded to the fetch; pre-aborted or mid-flight
   * abort rejects the promise with `AbortError`.
   *
   * No bounds check on `pageIndex` — follows the existing sidecar-accessor
   * precedent (`getTextContent`, `getLinks`, `getOutline`). Out-of-range
   * resolves to a 404 → `LEGACY_READING_ORDER`.
   */
  async getReadingOrder(
    pageIndex: number,
    options: ReadingOrderOptions = {},
  ): Promise<ReadingOrder> {
    this.requireInit();
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const url = this.buildSidecarUrl(pageIndex, 'reading-order');
    const res = await fetch(url, { credentials: this.credentials, signal: options.signal });
    if (res.status === 404) return LEGACY_READING_ORDER;
    if (!res.ok) {
      throw new Error(`Sidecar fetch failed (${res.status} ${res.statusText}) for ${url}`);
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (e) {
      throw new Error(
        `reading-order.json parse failed for ${url}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    // Structural envelope validation BEFORE narrowing — mirrors 8a's
    // searchTerm pattern. Each field has a guard so malformed non-legacy
    // bodies fail loudly instead of casting through.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`reading-order.json shape invalid for ${url}: not a plain object`);
    }
    if (Object.keys(parsed).length === 0) return LEGACY_READING_ORDER;
    const probed = parsed as Record<string, unknown>;
    if (probed.serializationVersion !== EXPECTED_READING_ORDER_SERIALIZATION_VERSION) {
      throw new Error(
        `reading-order.json serializationVersion mismatch for ${url}: adapter expects ${EXPECTED_READING_ORDER_SERIALIZATION_VERSION}, bundle declares ${String(probed.serializationVersion)}`,
      );
    }
    if (
      probed.source !== 'passthrough' &&
      probed.source !== 'structtree' &&
      probed.source !== 'heuristic'
    ) {
      // `source` is a CLOSED discriminator at the current `serializationVersion`.
      // A future producer that wants to introduce a fourth value MUST bump
      // `serializationVersion` (the closed-discriminator change is, by definition,
      // not consumer-additive — it changes which guarantees apply). Adapter
      // rejects unknown values to surface that drift loudly at parse time.
      throw new Error(
        `reading-order.json invalid for ${url}: 'source' must be 'passthrough' | 'structtree' | 'heuristic'; got ${JSON.stringify(probed.source)}`,
      );
    }
    if (!Array.isArray(probed.blocks)) {
      throw new Error(`reading-order.json invalid for ${url}: 'blocks' must be an array`);
    }
    if (!Array.isArray(probed.order)) {
      throw new Error(`reading-order.json invalid for ${url}: 'order' must be an array`);
    }
    if (!Array.isArray(probed.errors)) {
      throw new Error(`reading-order.json invalid for ${url}: 'errors' must be an array`);
    }

    // Per-element shape checks. Cheap; fails loudly on malformed bodies.
    for (let i = 0; i < probed.blocks.length; i++) {
      const b = probed.blocks[i];
      if (typeof b !== 'object' || b === null || Array.isArray(b)) {
        throw new Error(`reading-order.json invalid for ${url}: blocks[${i}] is not an object`);
      }
      const bo = b as Record<string, unknown>;
      if (typeof bo.kind !== 'string') {
        throw new Error(`reading-order.json invalid for ${url}: blocks[${i}].kind must be a string`);
      }
      if (!isRectTuple(bo.rect)) {
        throw new Error(`reading-order.json invalid for ${url}: blocks[${i}].rect must be [x1, y1, x2, y2]`);
      }
      const hasRange = bo.itemRange !== undefined;
      const hasItems = bo.items !== undefined;
      if (hasRange && hasItems) {
        throw new Error(`reading-order.json invalid for ${url}: blocks[${i}] has both itemRange and items; mutually exclusive`);
      }
      if (!hasRange && !hasItems) {
        throw new Error(`reading-order.json invalid for ${url}: blocks[${i}] has neither itemRange nor items; exactly one required (use items: [] for empty textless blocks)`);
      }
      if (hasRange) {
        const r = bo.itemRange;
        if (
          !Array.isArray(r) ||
          r.length !== 2 ||
          !Number.isInteger(r[0]) ||
          !Number.isInteger(r[1]) ||
          (r[0] as number) < 0 ||
          (r[1] as number) < (r[0] as number)
        ) {
          throw new Error(`reading-order.json invalid for ${url}: blocks[${i}].itemRange must be [start, endExclusive] of non-negative integers with start <= endExclusive`);
        }
      } else {
        // hasItems
        const arr = bo.items;
        if (!Array.isArray(arr) || arr.some((n) => !Number.isInteger(n) || (n as number) < 0)) {
          throw new Error(`reading-order.json invalid for ${url}: blocks[${i}].items must be an array of non-negative integers (use [] for empty textless blocks)`);
        }
      }
    }
    for (let i = 0; i < probed.order.length; i++) {
      const n = probed.order[i];
      if (!Number.isInteger(n) || (n as number) < 0 || (n as number) >= probed.blocks.length) {
        throw new Error(`reading-order.json invalid for ${url}: order[${i}] must be a non-negative integer < blocks.length`);
      }
    }
    for (let i = 0; i < probed.errors.length; i++) {
      const e = probed.errors[i];
      if (
        typeof e !== 'object' ||
        e === null ||
        typeof (e as Record<string, unknown>).code !== 'string' ||
        typeof (e as Record<string, unknown>).message !== 'string'
      ) {
        throw new Error(`reading-order.json invalid for ${url}: errors[${i}] must have string 'code' and 'message'`);
      }
    }
    return parsed as ReadingOrder;
  }

  // ============================================================
  // Step 8c Phase B — getAccessibility() + getAccessibilityReport()
  // ============================================================

  /**
   * Fetch the per-page accessibility sidecar. Envelope-validating; on
   * legacy bundles (404 or `{}` placeholder) returns
   * `LEGACY_PAGE_ACCESSIBILITY` (empty regions / headings / altText / errors)
   * so callers don't need a try/catch around the legacy case.
   *
   * Throws on:
   * - non-404 HTTP failure
   * - JSON parse failure
   * - non-object body, non-empty body with wrong serializationVersion
   * - malformed `regions[]` / `headings[]` / `altText[]` / `errors[]` items
   * - `pageLabel` / `lang` not string-or-null
   * - `remediationStatus` not in `'needsReview' | 'verified' | 'modified'`
   * - missing or non-conforming `fingerprint` on any emitted item (16
   *   lowercase hex chars per producer §3.2 migration-key contract)
   *
   * `options.signal` is threaded to the underlying fetch; on abort the
   * promise rejects with `AbortError`.
   */
  async getAccessibility(
    pageIndex: number,
    options: AccessibilityOptions = {},
  ): Promise<PageAccessibility> {
    this.requireInit();
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const url = this.buildSidecarUrl(pageIndex, 'accessibility');
    const res = await fetch(url, { credentials: this.credentials, signal: options.signal });
    if (res.status === 404) return LEGACY_PAGE_ACCESSIBILITY;
    if (!res.ok) {
      throw new Error(`Sidecar fetch failed (${res.status} ${res.statusText}) for ${url}`);
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (e) {
      throw new Error(
        `accessibility.json parse failed for ${url}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`accessibility.json shape invalid for ${url}: not a plain object`);
    }
    if (Object.keys(parsed).length === 0) return LEGACY_PAGE_ACCESSIBILITY;

    const probed = parsed as Record<string, unknown>;
    if (probed.serializationVersion !== EXPECTED_PAGE_ACCESSIBILITY_SERIALIZATION_VERSION) {
      throw new Error(
        `accessibility.json serializationVersion mismatch for ${url}: adapter expects ${EXPECTED_PAGE_ACCESSIBILITY_SERIALIZATION_VERSION}, bundle declares ${String(probed.serializationVersion)}`,
      );
    }

    if (probed.pageLabel !== null && typeof probed.pageLabel !== 'string') {
      throw new Error(`accessibility.json invalid for ${url}: pageLabel must be string or null`);
    }
    if (probed.lang !== null && typeof probed.lang !== 'string') {
      throw new Error(`accessibility.json invalid for ${url}: lang must be string or null`);
    }

    if (
      probed.remediationStatus !== 'needsReview' &&
      probed.remediationStatus !== 'verified' &&
      probed.remediationStatus !== 'modified'
    ) {
      throw new Error(
        `accessibility.json invalid for ${url}: remediationStatus must be 'needsReview' | 'verified' | 'modified'; got ${JSON.stringify(probed.remediationStatus)}`,
      );
    }

    if (!Array.isArray(probed.regions)) {
      throw new Error(`accessibility.json invalid for ${url}: 'regions' must be an array`);
    }
    if (!Array.isArray(probed.headings)) {
      throw new Error(`accessibility.json invalid for ${url}: 'headings' must be an array`);
    }
    if (!Array.isArray(probed.altText)) {
      throw new Error(`accessibility.json invalid for ${url}: 'altText' must be an array`);
    }
    if (!Array.isArray(probed.errors)) {
      throw new Error(`accessibility.json invalid for ${url}: 'errors' must be an array`);
    }

    probed.regions.forEach((r, i) => validateAccessibilityRegion(r, i, url));
    probed.headings.forEach((h, i) => validateAccessibilityHeading(h, i, url));
    probed.altText.forEach((a, i) => validateAccessibilityAltText(a, i, url));
    probed.errors.forEach((e, i) => validateAccessibilityErrorRecord(e, i, url));

    return parsed as PageAccessibility;
  }

  /**
   * Fetch the doc-level `accessibility-report.json`. Envelope-validating;
   * on legacy bundles (manifest field absent, 404, or `{}` placeholder)
   * returns `LEGACY_ACCESSIBILITY_REPORT` with `tagged: null` (the "we
   * didn't measure" sentinel).
   *
   * `options.signal` is threaded to the underlying fetch; on abort the
   * promise rejects with `AbortError`.
   */
  async getAccessibilityReport(
    options: AccessibilityOptions = {},
  ): Promise<AccessibilityReport> {
    this.requireInit();
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const path = this.manifest!.documentArtifacts.accessibilityReport;
    if (path === undefined) return LEGACY_ACCESSIBILITY_REPORT;
    const url = `${this.bundleUrl}/${path}`;
    const res = await fetch(url, { credentials: this.credentials, signal: options.signal });
    if (res.status === 404) return LEGACY_ACCESSIBILITY_REPORT;
    if (!res.ok) {
      throw new Error(`Sidecar fetch failed (${res.status} ${res.statusText}) for ${url}`);
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (e) {
      throw new Error(
        `accessibility-report.json parse failed for ${url}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        `accessibility-report.json shape invalid for ${url}: not a plain object`,
      );
    }
    if (Object.keys(parsed).length === 0) return LEGACY_ACCESSIBILITY_REPORT;

    const probed = parsed as Record<string, unknown>;
    if (probed.serializationVersion !== EXPECTED_ACCESSIBILITY_REPORT_SERIALIZATION_VERSION) {
      throw new Error(
        `accessibility-report.json serializationVersion mismatch for ${url}: adapter expects ${EXPECTED_ACCESSIBILITY_REPORT_SERIALIZATION_VERSION}, bundle declares ${String(probed.serializationVersion)}`,
      );
    }

    if (probed.tagged !== null && typeof probed.tagged !== 'boolean') {
      throw new Error(
        `accessibility-report.json invalid for ${url}: tagged must be boolean or null; got ${JSON.stringify(probed.tagged)}`,
      );
    }
    if (probed.lang !== null && typeof probed.lang !== 'string') {
      throw new Error(
        `accessibility-report.json invalid for ${url}: lang must be string or null; got ${JSON.stringify(probed.lang)}`,
      );
    }

    validateReportScoreSection(probed.structure, 'structure', url);
    validateReportHeadingsSection(probed.headings, url);
    validateReportAltTextSection(probed.altText, url);
    validateReportReadingOrderSection(probed.readingOrder, url);

    if (!Array.isArray(probed.errors)) {
      throw new Error(
        `accessibility-report.json invalid for ${url}: 'errors' must be an array`,
      );
    }
    probed.errors.forEach((e, i) => validateAccessibilityErrorRecord(e, i, url));

    validateExtractorDiagnostics(probed.extractorDiagnostics, url);

    return parsed as AccessibilityReport;
  }

  // ============================================================
  // Step 8a Phase G — searchTerm()
  // ============================================================

  /**
   * Search the document for `query`. Multi-token queries are AND-matched
   * (all tokens must appear on the same page; one hit per qualifying page).
   * Single-token queries return one hit per posting (may overshoot
   * `maxResults` at page boundaries; see plan §G "cap-at-page-boundary").
   *
   * Hit ordering: ascending `(pageIndex, itemIndex)`.
   *
   * Legacy bundles (no `search.json` artifact, 404, or `{}` placeholder)
   * return an empty array — gracefully treated as "search not available".
   * Envelope shape failures (wrong `format`, wrong `serializationVersion`,
   * non-object) throw with a diagnostic message.
   *
   * `options.signal` is threaded to every fetch (search.json + page text);
   * abort rejects the returned promise with `AbortError`.
   */
  async searchTerm(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    this.requireInit();

    // Cheap query-side defensive checks BEFORE network access. No fetch fires
    // for an invalid query — the cap protects the tokenizer + cache from
    // pathological-input DoS at the adapter trust boundary.
    if (query.length > QUERY_LENGTH_CAP) {
      throw new Error(
        `searchTerm: query exceeds ${QUERY_LENGTH_CAP}-char cap; truncate caller-side`,
      );
    }
    // Pre-aborted signal check — mirrors renderPage's pattern at the same
    // entry point. Native fetch would reject anyway when given an aborted
    // signal, but checking up front gives a deterministic AbortError without
    // racing the fetch implementation.
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    // Tokenize BEFORE fetch — pure CPU, cheap. If the query is all
    // punctuation/control/whitespace, tokens is empty and we short-circuit.
    const queryTokens = tokenizeQuery(trimmed).map((t) => t.text);
    if (queryTokens.length === 0) return [];

    // `documentArtifacts.search` is OPTIONAL. Treat absent as legacy.
    const searchPath = this.manifest!.documentArtifacts.search;
    if (searchPath === undefined) return LEGACY_SEARCH_HITS;
    const url = `${this.bundleUrl}/${searchPath}`;
    const res = await fetch(url, { credentials: this.credentials, signal: options.signal });
    if (res.status === 404) return LEGACY_SEARCH_HITS;
    if (!res.ok) {
      throw new Error(
        `Sidecar fetch failed (${res.status} ${res.statusText}) for ${url}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (parseErr) {
      throw new Error(
        `search.json parse failed for ${url}: ${
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        }. Bundle may be truncated, encoded incorrectly, or served with a non-JSON content type.`,
      );
    }

    // Plain-object guard. Without this, `[]` would be `Object.keys`-empty
    // (incorrectly treated as legacy); `null` would throw an unclear TypeError;
    // `42` would Object()-wrap and also look empty.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      const kind =
        parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
      throw new Error(
        `search.json shape invalid: expected plain object envelope, got ${kind}. Likely a malformed bundle.`,
      );
    }
    if (Object.keys(parsed).length === 0) return LEGACY_SEARCH_HITS;

    // Envelope shape: format + serializationVersion checks before narrowing.
    const probed = parsed as { format?: unknown; serializationVersion?: unknown };
    if (probed.format !== EXPECTED_FORMAT) {
      throw new Error(
        `search.json format mismatch: adapter expects '${EXPECTED_FORMAT}', bundle declares '${String(
          probed.format,
        )}'. Re-convert the bundle or upgrade the adapter.`,
      );
    }
    if (probed.serializationVersion !== EXPECTED_SERIALIZATION_VERSION) {
      throw new Error(
        `search.json serializationVersion mismatch: adapter expects ${EXPECTED_SERIALIZATION_VERSION}, bundle declares ${String(
          probed.serializationVersion,
        )}.`,
      );
    }
    const envelope = parsed as SearchIndexEnvelope;

    // Per-page extraction errors are recoverable — the index is still valid
    // for pages that succeeded. Warn once per instance so repeated searches
    // don't spam the console.
    if (envelope.errors.length > 0 && !this.warnedAboutSearchErrors) {
      console.warn(
        `[api-adapter] search.json reports ${envelope.errors.length} extraction error(s):`,
        envelope.errors,
      );
      this.warnedAboutSearchErrors = true;
    }

    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    const index = envelope.index as InvertedIndex; // narrowed by EXPECTED_FORMAT === 'inverted'

    const rawHits: Array<Omit<SearchHit, 'contextSnippet'>> =
      queryTokens.length === 1
        ? findSingleToken(index, queryTokens[0], maxResults)
        : findMultiTokenAnd(index, queryTokens, maxResults);

    // Snippet enrichment IN PARALLEL via Promise.all — sequential awaits
    // would blow the SLO budget on non-trivial hit counts. The per-instance
    // `pageTextCache` dedups fetches when multiple hits share a page.
    const enriched: SearchHit[] = await Promise.all(
      rawHits.map(async (hit) => {
        const items = await this.loadPageTextForSnippet(hit.pageIndex, options.signal);
        return { ...hit, contextSnippet: buildSnippet(items, hit.itemIndex) };
      }),
    );
    return enriched;
  }

  /**
   * Per-page text cache for snippet enrichment. Stores the in-flight
   * `Promise<TextItem[]>` so concurrent awaiters dedup; once resolved, the
   * Promise's value is returned synchronously on subsequent lookups. Negative
   * caching (failure → `[]`) prevents re-fetch of a broken sidecar.
   */
  private pageTextCache = new Map<number, Promise<TextItem[]>>();

  /** Warn-once flag for `search.json::errors[]` surfacing. */
  private warnedAboutSearchErrors = false;

  /** Per-page set of pages we've already warned about for snippet failures. */
  private warnedFailedSnippetPages = new Set<number>();

  private loadPageTextForSnippet(pageIndex: number, signal?: AbortSignal): Promise<TextItem[]> {
    const cached = this.pageTextCache.get(pageIndex);
    if (cached !== undefined) return cached;
    const promise = this.fetchPageText(pageIndex, signal);
    this.pageTextCache.set(pageIndex, promise);
    // If the promise rejects (only AbortError reaches here — every other
    // failure path is swallowed in fetchPageText and returns []), evict so
    // the next query can retry without inheriting the cached rejection.
    promise.catch(() => this.pageTextCache.delete(pageIndex));
    return promise;
  }

  private async fetchPageText(pageIndex: number, signal?: AbortSignal): Promise<TextItem[]> {
    const url = this.buildSidecarUrl(pageIndex, 'text');
    // Negative caching applies to RECOVERABLE failure paths (404, network,
    // parse, shape). A broken sidecar should NOT take down the whole search
    // — the snippet becomes "" for hits on that page; hit metadata
    // (pageIndex + itemIndex + matchedToken) is still useful UX. One warn
    // per page per failure kind, dedup'd via `warnedFailedSnippetPages`.
    // AbortError is the EXCEPTION: the user explicitly canceled the query —
    // propagate so the searchTerm promise rejects per the §G AbortSignal
    // contract.
    let res: Response;
    try {
      res = await fetch(url, { credentials: this.credentials, signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      this.warnFailedSnippet(pageIndex, 'network', err);
      return [];
    }
    if (res.status === 404) {
      this.warnFailedSnippet(pageIndex, 'missing', `HTTP 404 at ${url}`);
      return [];
    }
    if (!res.ok) {
      this.warnFailedSnippet(
        pageIndex,
        'http_error',
        `HTTP ${res.status} ${res.statusText} at ${url}`,
      );
      return [];
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch (err) {
      this.warnFailedSnippet(pageIndex, 'parse', err);
      return [];
    }

    if (!Array.isArray((parsed as { items?: unknown })?.items)) {
      this.warnFailedSnippet(
        pageIndex,
        'shape',
        'text.json does not contain an items array',
      );
      return [];
    }
    return (parsed as { items: TextItem[] }).items;
  }

  private warnFailedSnippet(pageIndex: number, kind: string, detail: unknown): void {
    if (this.warnedFailedSnippetPages.has(pageIndex)) return;
    this.warnedFailedSnippetPages.add(pageIndex);
    console.warn(
      `[api-adapter] snippet load failed for page ${pageIndex} (${kind}); snippets for this page will be empty. Detail:`,
      detail,
    );
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

    // 8a Phase G: clear search-index instance state. Idempotent; safe on an
    // already-disposed instance.
    this.pageTextCache.clear();
    this.warnedFailedSnippetPages.clear();
    this.warnedAboutSearchErrors = false;
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

// ============================================================
// Step 8b Phase B — reading-order helpers (module-private)
// ============================================================

/**
 * Type predicate for a 4-tuple of finite numbers. Rejects non-arrays, wrong
 * length, NaN, and ±Infinity. Reading-order rect coords are CSS-pixel
 * canonical-box floats per producer-side `[f32; 4]`; we accept the JS
 * `number` (f64) widening and only require finiteness.
 */
function isRectTuple(v: unknown): v is [number, number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

// ============================================================
// Step 8c Phase B — accessibility helpers (module-private)
// ============================================================

/**
 * `AccessibilitySource` is an OPEN union (§5.1 schema decision). Adapter
 * accepts ANY non-empty string. Known values get TypeScript autocomplete
 * via the `'structtree' | 'heuristic' | 'manual' | (string & {})`
 * declaration; unknown values are surfaced as-is for consumer UIs to
 * display as "unspecified provenance."
 */
function isAccessibilitySource(v: unknown): v is AccessibilitySource {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Fingerprint shape: SHA-1 hex prefix, 16 lowercase hex chars (64 bits of
 * entropy). Adapter validates structural shape only — does NOT recompute
 * the hash (which requires the producer's canonical key formula and is
 * out-of-scope for adapter parse).
 */
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
function isFingerprint(v: unknown): v is string {
  return typeof v === 'string' && FINGERPRINT_RE.test(v);
}

// v1 producer emits `regions: []` always (§1 honesty discipline), so this
// validator runs against zero items in v1. Required regardless: 8c.1's
// heuristic emission and Step 16's manual region overlays both surface
// entries through the same validator.
function validateAccessibilityRegion(r: unknown, i: number, url: string): void {
  if (typeof r !== 'object' || r === null || Array.isArray(r)) {
    throw new Error(`accessibility.json invalid for ${url}: regions[${i}] is not an object`);
  }
  const ro = r as Record<string, unknown>;
  if (typeof ro.id !== 'string' || ro.id.length === 0) {
    throw new Error(`accessibility.json invalid for ${url}: regions[${i}].id must be a non-empty string`);
  }
  if (typeof ro.kind !== 'string') {
    throw new Error(`accessibility.json invalid for ${url}: regions[${i}].kind must be a string`);
  }
  if (!isRectTuple(ro.rect)) {
    throw new Error(`accessibility.json invalid for ${url}: regions[${i}].rect must be [x1, y1, x2, y2]`);
  }
  if (!isAccessibilitySource(ro.source)) {
    throw new Error(`accessibility.json invalid for ${url}: regions[${i}].source must be a non-empty string`);
  }
  if (!isFingerprint(ro.fingerprint)) {
    throw new Error(`accessibility.json invalid for ${url}: regions[${i}].fingerprint must be 16 lowercase hex chars`);
  }
}

function validateAccessibilityHeading(h: unknown, i: number, url: string): void {
  if (typeof h !== 'object' || h === null || Array.isArray(h)) {
    throw new Error(`accessibility.json invalid for ${url}: headings[${i}] is not an object`);
  }
  const ho = h as Record<string, unknown>;
  if (typeof ho.id !== 'string' || ho.id.length === 0) {
    throw new Error(`accessibility.json invalid for ${url}: headings[${i}].id must be a non-empty string`);
  }
  if (!Number.isInteger(ho.level) || (ho.level as number) < 1 || (ho.level as number) > 6) {
    throw new Error(`accessibility.json invalid for ${url}: headings[${i}].level must be an integer 1-6, got ${JSON.stringify(ho.level)}`);
  }
  if (typeof ho.text !== 'string') {
    throw new Error(`accessibility.json invalid for ${url}: headings[${i}].text must be a string (may be empty if /ActualText absent per §1)`);
  }
  if (!isRectTuple(ho.rect)) {
    throw new Error(`accessibility.json invalid for ${url}: headings[${i}].rect must be [x1, y1, x2, y2] of finite numbers`);
  }
  if (!isAccessibilitySource(ho.source)) {
    throw new Error(`accessibility.json invalid for ${url}: headings[${i}].source must be a non-empty string`);
  }
  if (!isFingerprint(ho.fingerprint)) {
    throw new Error(`accessibility.json invalid for ${url}: headings[${i}].fingerprint must be 16 lowercase hex chars`);
  }
}

function validateAccessibilityAltText(a: unknown, i: number, url: string): void {
  if (typeof a !== 'object' || a === null || Array.isArray(a)) {
    throw new Error(`accessibility.json invalid for ${url}: altText[${i}] is not an object`);
  }
  const ao = a as Record<string, unknown>;
  if (typeof ao.id !== 'string' || ao.id.length === 0) {
    throw new Error(`accessibility.json invalid for ${url}: altText[${i}].id must be a non-empty string`);
  }
  if (!isRectTuple(ao.imageRect)) {
    throw new Error(`accessibility.json invalid for ${url}: altText[${i}].imageRect must be [x1, y1, x2, y2] of finite numbers`);
  }
  if (typeof ao.text !== 'string') {
    throw new Error(`accessibility.json invalid for ${url}: altText[${i}].text must be a string (may be empty for images with no /Alt per §1)`);
  }
  if (!isAccessibilitySource(ao.source)) {
    throw new Error(`accessibility.json invalid for ${url}: altText[${i}].source must be a non-empty string`);
  }
  if (!isFingerprint(ao.fingerprint)) {
    throw new Error(`accessibility.json invalid for ${url}: altText[${i}].fingerprint must be 16 lowercase hex chars`);
  }
}

function validateAccessibilityErrorRecord(e: unknown, i: number, url: string): void {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) {
    throw new Error(`accessibility.json invalid for ${url}: errors[${i}] is not an object`);
  }
  const eo = e as Record<string, unknown>;
  if (typeof eo.feature !== 'string') {
    throw new Error(`accessibility.json invalid for ${url}: errors[${i}].feature must be a string ('headings' | 'altText' | 'structure' | 'document')`);
  }
  if (typeof eo.code !== 'string') {
    throw new Error(`accessibility.json invalid for ${url}: errors[${i}].code must be a string`);
  }
  if (typeof eo.message !== 'string') {
    throw new Error(`accessibility.json invalid for ${url}: errors[${i}].message must be a string`);
  }
}

// --- accessibility-report.json section validators ---
//
// `source: null` is explicitly accepted on every section. Per producer §3.3
// the producer emits null when `tagged === false` (we didn't measure via
// StructTree) AND `LEGACY_ACCESSIBILITY_REPORT` (the {}-placeholder fallback)
// also has null source across all sections. Adapter rejecting null would
// break both the untagged-doc happy path AND the legacy-bundle
// graceful-degradation contract.

function validateReportScoreSection(v: unknown, name: string, url: string): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`accessibility-report.json invalid for ${url}: '${name}' must be an object`);
  }
  const o = v as Record<string, unknown>;
  if (
    o.score !== null &&
    (typeof o.score !== 'number' ||
      !Number.isFinite(o.score) ||
      (o.score as number) < 0 ||
      (o.score as number) > 1)
  ) {
    throw new Error(`accessibility-report.json invalid for ${url}: '${name}.score' must be a finite number in [0, 1] or null`);
  }
  if (o.source !== null && !isAccessibilitySource(o.source)) {
    throw new Error(`accessibility-report.json invalid for ${url}: '${name}.source' must be a non-empty string or null`);
  }
}

function validateReportHeadingsSection(v: unknown, url: string): void {
  validateReportScoreSection(v, 'headings', url);
  const o = v as Record<string, unknown>;
  if (!Number.isInteger(o.extracted) || (o.extracted as number) < 0) {
    throw new Error(`accessibility-report.json invalid for ${url}: 'headings.extracted' must be a non-negative integer`);
  }
  if (o.missing !== null && (!Number.isInteger(o.missing) || (o.missing as number) < 0)) {
    throw new Error(`accessibility-report.json invalid for ${url}: 'headings.missing' must be a non-negative integer or null`);
  }
}

function validateReportAltTextSection(v: unknown, url: string): void {
  validateReportScoreSection(v, 'altText', url);
  const o = v as Record<string, unknown>;
  if (!Number.isInteger(o.extracted) || (o.extracted as number) < 0) {
    throw new Error(`accessibility-report.json invalid for ${url}: 'altText.extracted' must be a non-negative integer`);
  }
  if (!Number.isInteger(o.missing) || (o.missing as number) < 0) {
    throw new Error(`accessibility-report.json invalid for ${url}: 'altText.missing' must be a non-negative integer`);
  }
  if (!Number.isInteger(o.imageCount) || (o.imageCount as number) < 0) {
    throw new Error(`accessibility-report.json invalid for ${url}: 'altText.imageCount' must be a non-negative integer`);
  }
}

function validateReportReadingOrderSection(v: unknown, url: string): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`accessibility-report.json invalid for ${url}: 'readingOrder' must be an object`);
  }
  const o = v as Record<string, unknown>;
  if (
    o.score !== null &&
    (typeof o.score !== 'number' ||
      !Number.isFinite(o.score) ||
      (o.score as number) < 0 ||
      (o.score as number) > 1)
  ) {
    throw new Error(`accessibility-report.json invalid for ${url}: 'readingOrder.score' must be a finite number in [0, 1] or null`);
  }
  if (
    o.source !== 'passthrough' &&
    o.source !== 'structtree' &&
    o.source !== 'heuristic'
  ) {
    throw new Error(`accessibility-report.json invalid for ${url}: 'readingOrder.source' must be 'passthrough' | 'structtree' | 'heuristic'`);
  }
}

function validateExtractorDiagnostics(v: unknown, url: string): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`accessibility-report.json invalid for ${url}: 'extractorDiagnostics' must be an object`);
  }
  const o = v as Record<string, unknown>;
  const validateCounterObject = (
    obj: unknown,
    name: string,
    fields: readonly string[],
  ): void => {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      throw new Error(`accessibility-report.json invalid for ${url}: 'extractorDiagnostics.${name}' must be an object`);
    }
    const oo = obj as Record<string, unknown>;
    for (const f of fields) {
      if (!Number.isInteger(oo[f]) || (oo[f] as number) < 0) {
        throw new Error(`accessibility-report.json invalid for ${url}: 'extractorDiagnostics.${name}.${f}' must be a non-negative integer`);
      }
    }
  };
  validateCounterObject(o.headings, 'headings', [
    'seen',
    'skipped_missing_bbox',
    'emitted',
    'emitted_with_text',
  ]);
  validateCounterObject(o.figures, 'figures', [
    'seen',
    'skipped_missing_bbox',
    'skipped_missing_alt',
    'emitted_with_alt',
  ]);
  validateCounterObject(o.images, 'images', [
    'enumerated',
    'matched_to_figure',
    'unmatched',
  ]);
}

// ============================================================
// Step 8a Phase G — search helpers (module-private)
// ============================================================

/**
 * Single-token search against the inverted index. Returns one hit per posting
 * in `(pageIndex, itemIndex)` ascending order. Cap-at-page-boundary: once
 * `maxResults` is reached, finish the current page then stop before starting
 * a new one. Consumer who needs a sharp cap does `.slice(0, maxResults)`.
 */
function findSingleToken(
  index: InvertedIndex,
  token: string,
  maxResults: number,
): Array<Omit<SearchHit, 'contextSnippet'>> {
  const postings = index[token];
  if (postings === undefined || postings.length === 0) return [];
  // Defensive sort: the Rust builder emits postings in PageTokens order (which
  // is page-then-item ascending), but a future builder change could shift this
  // — sorting here keeps the consumer-side guarantee firm.
  const sorted = [...postings].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const hits: Array<Omit<SearchHit, 'contextSnippet'>> = [];
  let lastPageIndex = -1;
  for (const [pageIndex, itemIndex] of sorted) {
    if (hits.length >= maxResults && pageIndex !== lastPageIndex) break;
    hits.push({ pageIndex, itemIndex, matchedToken: token });
    lastPageIndex = pageIndex;
  }
  return hits;
}

/**
 * Multi-token AND search. Returns one hit per page where ALL tokens appear.
 * `matchedToken` is the FIRST query token (per the locked §G semantics); the
 * `itemIndex` references that token's first occurrence on the page.
 *
 * `maxResults` is enforced at exact page granularity here (no overshoot)
 * — one hit per qualifying page.
 */
function findMultiTokenAnd(
  index: InvertedIndex,
  tokens: string[],
  maxResults: number,
): Array<Omit<SearchHit, 'contextSnippet'>> {
  const firstToken = tokens[0];

  // Per-token: set of pageIndices the token appears on.
  const perTokenPageSets = tokens.map((t) => {
    const set = new Set<number>();
    const postings = index[t];
    if (postings !== undefined) {
      for (const [pageIndex] of postings) set.add(pageIndex);
    }
    return set;
  });

  // Empty intersection short-circuit: if any token never appears, no hits.
  if (perTokenPageSets.some((s) => s.size === 0)) return [];

  // Intersect from the smallest set outward (cheaper).
  const orderedBySize = [...perTokenPageSets].sort((a, b) => a.size - b.size);
  let intersection = new Set<number>(orderedBySize[0]);
  for (let i = 1; i < orderedBySize.length; i++) {
    const next = new Set<number>();
    for (const p of intersection) if (orderedBySize[i].has(p)) next.add(p);
    intersection = next;
    if (intersection.size === 0) return [];
  }

  // First-occurrence itemIndex of FIRST token on each qualifying page.
  const firstTokenPostings = index[firstToken] ?? [];
  const pageToFirstItem = new Map<number, number>();
  for (const [pageIndex, itemIndex] of firstTokenPostings) {
    if (intersection.has(pageIndex) && !pageToFirstItem.has(pageIndex)) {
      pageToFirstItem.set(pageIndex, itemIndex);
    }
  }

  const sortedPages = [...pageToFirstItem.keys()].sort((a, b) => a - b);
  return sortedPages.slice(0, maxResults).map((p) => ({
    pageIndex: p,
    itemIndex: pageToFirstItem.get(p)!,
    matchedToken: firstToken,
  }));
}

/**
 * Build a ~50-char contextSnippet around the matching item. Window the items
 * `[itemIndex - SNIPPET_WINDOW_BEFORE, itemIndex + SNIPPET_WINDOW_AFTER)`,
 * concatenate `.text`, trim to `SNIPPET_MAX_CHARS` centered on the hit, snap
 * to word boundaries (FlexSearch-style — mid-word cuts look broken), sanitize
 * per §3.9 (NFC + null-strip) AND strip HTML-active chars for XSS
 * defense-in-depth. Ellipses denote trimmed edges.
 */
export function buildSnippet(items: TextItem[], itemIndex: number): string {
  if (items.length === 0) return '';

  const startIdx = Math.max(0, itemIndex - SNIPPET_WINDOW_BEFORE);
  const endIdx = Math.min(items.length, itemIndex + SNIPPET_WINDOW_AFTER);
  let raw = items
    .slice(startIdx, endIdx)
    .map((i) => i.text)
    .join('');

  let trimmedFront = startIdx > 0;
  let trimmedBack = endIdx < items.length;

  if (raw.length > SNIPPET_MAX_CHARS) {
    const center = itemIndex - startIdx;
    const sliceStart = Math.max(0, center - Math.floor(SNIPPET_MAX_CHARS / 2));
    raw = raw.slice(sliceStart, sliceStart + SNIPPET_MAX_CHARS);
    if (sliceStart > 0) trimmedFront = true;
    trimmedBack = true;
  }

  // Snap to word boundaries — drop a partial word at the leading edge and
  // trailing edge if we trimmed there. Mid-word cuts read as broken text.
  if (trimmedFront && TRIM_PARTIAL_WORD_LEAD.test(raw)) {
    raw = raw.replace(TRIM_PARTIAL_WORD_LEAD, '');
  }
  if (trimmedBack && TRIM_PARTIAL_WORD_TAIL.test(raw)) {
    raw = raw.replace(TRIM_PARTIAL_WORD_TAIL, '');
  }

  // §3.9 sanitization: null-strip + NFC normalize.
  raw = raw.replace(/\0/g, '').normalize('NFC');

  // XSS defense-in-depth: strip (not escape) HTML-active chars. The snippet
  // contract is PLAIN TEXT (see SearchHit.contextSnippet doc). Strip-not-escape
  // because the field is shown as text — escaping would render literal `&lt;`
  // which is worse UX for a snippet of book content.
  raw = raw.replace(HTML_ACTIVE_CHARS_RE, '');

  return (trimmedFront ? '…' : '') + raw + (trimmedBack ? '…' : '');
}
