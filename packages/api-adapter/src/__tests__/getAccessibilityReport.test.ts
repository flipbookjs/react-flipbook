/**
 * Step 8c Phase B — adapter `getAccessibilityReport()` test suite. Mocks
 * `fetch` to serve synthetic manifests + accessibility-report.json
 * envelopes. Mirrors getAccessibility.test.ts structure.
 *
 * 12 tests per step-8c §6 acceptance-gate item 15.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreRenderedPageSource } from '../PreRenderedPageSource';
import type {
  AccessibilityReport,
  Manifest,
} from '../PreRenderedPageSource';

// ---- Fixture helpers ----

function makeManifestObject(
  overrides: Partial<Manifest> = {},
): Record<string, unknown> {
  return {
    manifestVersion: 1,
    documentId: 'doc_test',
    contentHash: 'sha256:abc',
    status: 'ready',
    generatedAt: '2026-06-27T00:00:00Z',
    pageCount: 3,
    defaults: {
      widths: [512, 1024, 2048, 4096],
      format: 'webp',
      tierUrlTemplate: 'pages/{page}/width-{width}.{format}',
      sidecarUrlTemplate: 'pages/{page}/{sidecar}.json',
      pageNumberDigits: 4,
    },
    pages: [
      { size: [594, 792], rotation: 0 },
      { size: [594, 792], rotation: 0 },
      { size: [594, 792], rotation: 0 },
    ],
    documentArtifacts: {
      outline: 'outline.json',
      accessibilityReport: 'accessibility-report.json',
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function wellFormedReport(
  overrides: Partial<AccessibilityReport> = {},
): Record<string, unknown> {
  return {
    serializationVersion: 1,
    tagged: false,
    lang: null,
    structure: { score: null, source: null },
    headings: { score: null, source: null, extracted: 0, missing: null },
    altText: { score: null, source: null, extracted: 0, missing: 0, imageCount: 0 },
    readingOrder: { score: null, source: 'passthrough' },
    errors: [],
    extractorDiagnostics: {
      headings: { seen: 0, skipped_missing_bbox: 0, emitted: 0, emitted_with_text: 0 },
      figures: {
        seen: 0,
        skipped_missing_bbox: 0,
        skipped_missing_alt: 0,
        emitted_with_alt: 0,
      },
      images: { enumerated: 0, matched_to_figure: 0, unmatched: 0 },
    },
    ...overrides,
  };
}

function mockFetchRouter(
  routes: Record<string, () => Response | Promise<Response>>,
): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const signal = init?.signal;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    for (const pattern of Object.keys(routes)) {
      if (url.endsWith(pattern)) {
        const r = routes[pattern]();
        if (r instanceof Promise) {
          return new Promise<Response>((resolve, reject) => {
            const onAbort = (): void =>
              reject(new DOMException('aborted', 'AbortError'));
            signal?.addEventListener('abort', onAbort, { once: true });
            r.then((res) => {
              signal?.removeEventListener('abort', onAbort);
              resolve(res);
            }).catch((e) => {
              signal?.removeEventListener('abort', onAbort);
              reject(e);
            });
          });
        }
        return r;
      }
    }
    throw new Error(
      `mockFetchRouter: unmatched URL ${url}; routes: ${Object.keys(routes).join(', ')}`,
    );
  });
}

async function makeInitializedSource(
  reportBody: Record<string, unknown> | null,
  manifestOverrides: Partial<Manifest> = {},
): Promise<PreRenderedPageSource> {
  mockFetchRouter({
    'manifest.json': () => jsonResponse(makeManifestObject(manifestOverrides)),
    'accessibility-report.json': () =>
      reportBody === null
        ? new Response('', { status: 404 })
        : jsonResponse(reportBody),
  });
  const source = new PreRenderedPageSource({ bundleUrl: '/bundle' });
  await source.init();
  return source;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PreRenderedPageSource.getAccessibilityReport', () => {
  // 1. Well-formed envelope narrows correctly.
  it('returns the parsed report for a well-formed bundle', async () => {
    const source = await makeInitializedSource(
      wellFormedReport({
        tagged: true,
        lang: 'en-US',
        structure: { score: 0.5, source: 'structtree' },
      }),
    );
    const r = await source.getAccessibilityReport();
    expect(r.serializationVersion).toBe(1);
    expect(r.tagged).toBe(true);
    expect(r.lang).toBe('en-US');
    expect(r.structure.score).toBe(0.5);
    expect(r.structure.source).toBe('structtree');
    expect(r.readingOrder.source).toBe('passthrough');
  });

  // 2. Missing manifest field → LEGACY_ACCESSIBILITY_REPORT.
  it('returns LEGACY_ACCESSIBILITY_REPORT when manifest has no accessibilityReport field', async () => {
    const source = await makeInitializedSource(wellFormedReport(), {
      documentArtifacts: { outline: 'outline.json' },
    });
    const r = await source.getAccessibilityReport();
    expect(r.tagged).toBe(null);
    expect(r.structure.score).toBe(null);
    expect(r.extractorDiagnostics.headings.seen).toBe(0);
  });

  // 3. 404 → LEGACY_ACCESSIBILITY_REPORT.
  it('returns LEGACY_ACCESSIBILITY_REPORT on 404', async () => {
    const source = await makeInitializedSource(null);
    const r = await source.getAccessibilityReport();
    expect(r.tagged).toBe(null);
    expect(r.errors).toEqual([]);
  });

  // 4. {} placeholder → LEGACY_ACCESSIBILITY_REPORT.
  it('returns LEGACY_ACCESSIBILITY_REPORT on empty-object placeholder', async () => {
    const source = await makeInitializedSource({});
    const r = await source.getAccessibilityReport();
    expect(r.tagged).toBe(null);
    expect(r.extractorDiagnostics.images.enumerated).toBe(0);
  });

  // 5. Wrong serializationVersion rejects.
  it('rejects wrong serializationVersion with a clear error', async () => {
    const source = await makeInitializedSource({
      ...wellFormedReport(),
      serializationVersion: 2,
    });
    await expect(source.getAccessibilityReport()).rejects.toThrow(
      /serializationVersion mismatch.*adapter expects 1.*bundle declares 2/,
    );
  });

  // 6. Non-boolean-non-null tagged rejects.
  it('rejects tagged that is not boolean-or-null', async () => {
    const source = await makeInitializedSource({
      ...wellFormedReport(),
      tagged: 'true',
    });
    await expect(source.getAccessibilityReport()).rejects.toThrow(
      /tagged must be boolean or null/,
    );
  });

  // 7. structure.score out of [0, 1] rejects.
  it('rejects structure.score outside [0, 1]', async () => {
    const source = await makeInitializedSource({
      ...wellFormedReport(),
      structure: { score: 1.5, source: 'structtree' },
    });
    await expect(source.getAccessibilityReport()).rejects.toThrow(
      /'structure\.score' must be a finite number in \[0, 1\] or null/,
    );
  });

  // 8. Missing extractorDiagnostics rejects.
  it('rejects when extractorDiagnostics is missing or not an object', async () => {
    const source = await makeInitializedSource({
      ...wellFormedReport(),
      extractorDiagnostics: null,
    });
    await expect(source.getAccessibilityReport()).rejects.toThrow(
      /'extractorDiagnostics' must be an object/,
    );
  });

  // 9. Negative diagnostic counter rejects.
  it('rejects negative counter on extractorDiagnostics.headings.seen', async () => {
    const baseDiag = wellFormedReport().extractorDiagnostics as AccessibilityReport['extractorDiagnostics'];
    const source = await makeInitializedSource({
      ...wellFormedReport(),
      extractorDiagnostics: {
        ...baseDiag,
        headings: { ...baseDiag.headings, seen: -1 },
      },
    });
    await expect(source.getAccessibilityReport()).rejects.toThrow(
      /'extractorDiagnostics\.headings\.seen' must be a non-negative integer/,
    );
  });

  // 10. Diagnostics with seen=0 + empty arrays is accepted (untagged baseline).
  it('accepts diagnostics with seen=0 (untagged baseline)', async () => {
    const source = await makeInitializedSource(wellFormedReport());
    const r = await source.getAccessibilityReport();
    expect(r.extractorDiagnostics.headings.seen).toBe(0);
    expect(r.extractorDiagnostics.headings.skipped_missing_bbox).toBe(0);
  });

  // 11. Doc-level errors[] entries flow through.
  it('accepts doc-level errors[] entries (e.g., structtree_load_failed)', async () => {
    const source = await makeInitializedSource({
      ...wellFormedReport(),
      tagged: true,
      errors: [
        {
          feature: 'document',
          code: 'structtree_load_failed',
          message:
            'doc claims IsTagged=true but all 1 pages returned NULL StructTree handles',
        },
      ],
    });
    const r = await source.getAccessibilityReport();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe('structtree_load_failed');
  });

  // 12. AbortSignal — pre-aborted rejects.
  it('honors AbortSignal: pre-aborted rejects with AbortError', async () => {
    const source = await makeInitializedSource(wellFormedReport());
    const controller = new AbortController();
    controller.abort();
    await expect(
      source.getAccessibilityReport({ signal: controller.signal }),
    ).rejects.toThrow(/aborted/i);
  });
});
