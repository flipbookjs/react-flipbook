/**
 * Step 8c Phase B — adapter `getAccessibility()` test suite. Mocks `fetch`
 * to serve synthetic manifests + accessibility.json envelopes without
 * needing real bundles on disk. Mirrors 8b's `getReadingOrder.test.ts`
 * structure (same `mockFetchRouter`, same `makeInitializedSource` pattern).
 *
 * 14 tests per step-8c §6 acceptance-gate item 14.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreRenderedPageSource } from '../PreRenderedPageSource';
import type {
  Manifest,
  PageAccessibility,
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
    documentArtifacts: { outline: 'outline.json' },
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

/**
 * Construct a well-formed v1 envelope for an untagged-doc page: empty
 * regions/headings/altText/errors arrays. Tests overlay overrides onto
 * this to construct the malformed shapes that the rejection paths exercise.
 */
function wellFormedEnvelope(
  overrides: Partial<PageAccessibility> = {},
): Record<string, unknown> {
  return {
    serializationVersion: 1,
    pageLabel: null,
    lang: null,
    remediationStatus: 'needsReview',
    regions: [],
    headings: [],
    altText: [],
    errors: [],
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
  body: Record<string, unknown> | null,
): Promise<PreRenderedPageSource> {
  mockFetchRouter({
    'manifest.json': () => jsonResponse(makeManifestObject()),
    'pages/0001/accessibility.json': () =>
      body === null ? new Response('', { status: 404 }) : jsonResponse(body),
  });
  const source = new PreRenderedPageSource({ bundleUrl: '/bundle' });
  await source.init();
  return source;
}

/** Well-formed heading object reused by several tests. */
const SAMPLE_HEADING = {
  id: 'h0',
  level: 1,
  text: 'Chapter 1',
  rect: [10.5, 60.0, 200.0, 90.0],
  source: 'structtree',
  fingerprint: '0123456789abcdef',
};

/** Well-formed altText object reused by several tests. */
const SAMPLE_ALT_TEXT = {
  id: 'alt0',
  imageRect: [50.0, 100.0, 250.0, 300.0],
  text: '',
  source: 'heuristic',
  fingerprint: 'abcdef0123456789',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PreRenderedPageSource.getAccessibility', () => {
  // 1. Well-formed envelope narrows correctly.
  it('returns the parsed envelope for a well-formed bundle', async () => {
    const source = await makeInitializedSource(
      wellFormedEnvelope({
        pageLabel: 'iii',
        lang: 'en-US',
        headings: [SAMPLE_HEADING] as PageAccessibility['headings'],
        altText: [SAMPLE_ALT_TEXT] as PageAccessibility['altText'],
      }),
    );
    const acc = await source.getAccessibility(0);
    expect(acc.serializationVersion).toBe(1);
    expect(acc.pageLabel).toBe('iii');
    expect(acc.lang).toBe('en-US');
    expect(acc.remediationStatus).toBe('needsReview');
    expect(acc.regions).toEqual([]);
    expect(acc.headings).toHaveLength(1);
    expect(acc.headings[0].text).toBe('Chapter 1');
    expect(acc.altText).toHaveLength(1);
    expect(acc.errors).toEqual([]);
  });

  // 2. 404 → LEGACY_PAGE_ACCESSIBILITY.
  it('returns LEGACY_PAGE_ACCESSIBILITY on 404', async () => {
    const source = await makeInitializedSource(null);
    const acc = await source.getAccessibility(0);
    expect(acc).toEqual({
      serializationVersion: 1,
      pageLabel: null,
      lang: null,
      remediationStatus: 'needsReview',
      regions: [],
      headings: [],
      altText: [],
      errors: [],
    });
  });

  // 3. {} placeholder → LEGACY_PAGE_ACCESSIBILITY.
  it('returns LEGACY_PAGE_ACCESSIBILITY on empty-object placeholder', async () => {
    const source = await makeInitializedSource({});
    const acc = await source.getAccessibility(0);
    expect(acc.remediationStatus).toBe('needsReview');
    expect(acc.regions).toEqual([]);
    expect(acc.headings).toEqual([]);
  });

  // 4. Wrong serializationVersion rejects with clear error.
  it('rejects wrong serializationVersion with a clear error', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(),
      serializationVersion: 2,
    });
    await expect(source.getAccessibility(0)).rejects.toThrow(
      /serializationVersion mismatch.*adapter expects 1.*bundle declares 2/,
    );
  });

  // 5. Non-object body rejects.
  it('rejects non-object shape (array body) with a clear error', async () => {
    mockFetchRouter({
      'manifest.json': () => jsonResponse(makeManifestObject()),
      'pages/0001/accessibility.json': () => jsonResponse([1, 2, 3]),
    });
    const source = new PreRenderedPageSource({ bundleUrl: '/bundle' });
    await source.init();
    await expect(source.getAccessibility(0)).rejects.toThrow(/not a plain object/);
  });

  // 6. Bad remediationStatus rejects.
  it('rejects an unknown remediationStatus value', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(),
      remediationStatus: 'in-progress',
    });
    await expect(source.getAccessibility(0)).rejects.toThrow(
      /remediationStatus must be 'needsReview' \| 'verified' \| 'modified'/,
    );
  });

  // 7. Bad pageLabel (non-string-non-null) rejects.
  it('rejects pageLabel that is not string-or-null', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(),
      pageLabel: 42,
    });
    await expect(source.getAccessibility(0)).rejects.toThrow(
      /pageLabel must be string or null/,
    );
  });

  // 8. Bad heading rect rejects.
  it('rejects heading rect that is not [x1, y1, x2, y2] of finite numbers', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(),
      headings: [{ ...SAMPLE_HEADING, rect: [1, 2, 3] }],
    });
    await expect(source.getAccessibility(0)).rejects.toThrow(
      /headings\[0\]\.rect must be \[x1, y1, x2, y2\]/,
    );
  });

  // 9. Bad heading level rejects (0 → out of 1-6).
  it('rejects heading level outside 1-6', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(),
      headings: [{ ...SAMPLE_HEADING, level: 7 }],
    });
    await expect(source.getAccessibility(0)).rejects.toThrow(
      /headings\[0\]\.level must be an integer 1-6/,
    );
  });

  // 10. Missing fingerprint on heading rejects.
  it('rejects heading missing the fingerprint field', async () => {
    const { fingerprint: _drop, ...rest } = SAMPLE_HEADING;
    void _drop;
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(),
      headings: [rest],
    });
    await expect(source.getAccessibility(0)).rejects.toThrow(
      /headings\[0\]\.fingerprint must be 16 lowercase hex chars/,
    );
  });

  // 11. Invalid fingerprint format rejects (uppercase / wrong length).
  it('rejects fingerprint with uppercase hex or wrong length', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(),
      headings: [{ ...SAMPLE_HEADING, fingerprint: 'ABC' }],
    });
    await expect(source.getAccessibility(0)).rejects.toThrow(
      /fingerprint must be 16 lowercase hex chars/,
    );
  });

  // 12. Unknown source value still ACCEPTED (open union per §5.1).
  it('accepts unknown source values per the open-union contract', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(),
      headings: [{ ...SAMPLE_HEADING, source: 'mcid-derived' }],
    });
    const acc = await source.getAccessibility(0);
    expect(acc.headings[0].source).toBe('mcid-derived');
  });

  // 13. AbortSignal — pre-aborted rejects without any fetch firing.
  it('honors AbortSignal: pre-aborted rejects with AbortError', async () => {
    const source = await makeInitializedSource(wellFormedEnvelope());
    const controller = new AbortController();
    controller.abort();
    await expect(
      source.getAccessibility(0, { signal: controller.signal }),
    ).rejects.toThrow(/aborted/i);
  });

  // 14. Partial extraction errors flow through (errors[] is well-formed).
  it('accepts a page with recoverable extraction errors[] entries', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(),
      errors: [
        {
          feature: 'structure',
          code: 'structtree_cycle',
          message: 'cycle at depth 2; walk abandoned',
        },
      ],
    });
    const acc = await source.getAccessibility(0);
    expect(acc.errors).toHaveLength(1);
    expect(acc.errors[0].code).toBe('structtree_cycle');
    expect(acc.errors[0].feature).toBe('structure');
  });
});
