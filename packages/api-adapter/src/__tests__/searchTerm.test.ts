/**
 * Step 8a Phase G — adapter `searchTerm()` test suite. Mocks `fetch` to serve
 * synthetic manifests + search.json envelopes + per-page text.json without
 * needing real bundles on disk. Each test sets up its own fetch mock matching
 * URL patterns; the bundle-fixture approach (as in the existing
 * `fixtures/doc_smoke_3pg/`) is reserved for E2E rather than unit.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreRenderedPageSource } from '../PreRenderedPageSource';
import type {
  Manifest,
  SearchIndexEnvelope,
  InvertedIndex,
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
    generatedAt: '2026-06-23T00:00:00Z',
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
    documentArtifacts: { outline: 'outline.json', search: 'search.json' },
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

function envelope(
  index: InvertedIndex,
  overrides: Partial<SearchIndexEnvelope> = {},
): SearchIndexEnvelope {
  const tokenCount = Object.values(index).reduce((n, v) => n + v.length, 0);
  return {
    format: 'inverted',
    serializationVersion: 1,
    index,
    errors: [],
    stats: {
      token_count: tokenCount,
      page_count: 3,
      errored_page_count: 0,
    },
    ...overrides,
  };
}

function textJson(items: Array<{ text: string }>): { items: Array<Record<string, unknown>> } {
  return {
    items: items.map((it, i) => ({
      text: it.text,
      x: 0,
      y: i * 10,
      width: 5,
      height: 10,
      fontName: 'Helvetica',
      fontSize: 10,
    })),
  };
}

/**
 * Route incoming fetches to per-URL handlers. Each handler returns a Response
 * (or a Promise of one). Unmatched URLs reject with a descriptive error so
 * test failures point at the missing handler instead of a cryptic
 * TypeError ("Cannot read .ok of undefined").
 */
function mockFetchRouter(routes: Record<string, () => Response | Promise<Response>>): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const signal = init?.signal;
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const pattern of Object.keys(routes)) {
      if (url.endsWith(pattern)) {
        const r = routes[pattern]();
        // Make the route's promise signal-aware: if the caller aborts before
        // the route resolves, reject with AbortError. Real fetch does this;
        // the mock has to replicate it for the mid-flight test to exercise
        // the same code path the production adapter uses.
        if (r instanceof Promise) {
          return new Promise<Response>((resolve, reject) => {
            const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
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
    throw new Error(`mockFetchRouter: unmatched URL ${url}; routes: ${Object.keys(routes).join(', ')}`);
  });
}

async function makeInitializedSource(
  envelopeBody: SearchIndexEnvelope | Record<string, unknown> | null,
  textPerPage: Record<string, ReturnType<typeof textJson>> = {},
  manifestOverrides: Partial<Manifest> = {},
): Promise<PreRenderedPageSource> {
  const routes: Record<string, () => Response | Promise<Response>> = {
    'manifest.json': () => jsonResponse(makeManifestObject(manifestOverrides)),
    'search.json': () =>
      envelopeBody === null
        ? new Response('', { status: 404 })
        : jsonResponse(envelopeBody),
  };
  for (const [pageId, body] of Object.entries(textPerPage)) {
    routes[`pages/${pageId}/text.json`] = () => jsonResponse(body);
  }
  mockFetchRouter(routes);
  const source = new PreRenderedPageSource({ bundleUrl: '/bundle' });
  await source.init();
  return source;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================
// 8a Phase G — searchTerm tests
// ============================================================

describe('PreRenderedPageSource.searchTerm', () => {
  describe('happy path (overview §6 item 8 naming)', () => {
    it('searchTerm_returns_hits_in_document_order — single-token, sorted by (pageIndex, itemIndex)', async () => {
      const index: InvertedIndex = {
        hello: [
          [2, 1],
          [0, 5],
          [1, 3],
          [0, 12],
        ],
      };
      const source = await makeInitializedSource(envelope(index), {
        '0001': textJson([{ text: 'a' }, { text: 'b' }, { text: 'c' }]),
        '0002': textJson([{ text: 'd' }, { text: 'e' }, { text: 'f' }]),
        '0003': textJson([{ text: 'g' }, { text: 'h' }, { text: 'i' }]),
      });

      const hits = await source.searchTerm('hello');
      expect(hits.map((h) => [h.pageIndex, h.itemIndex])).toEqual([
        [0, 5],
        [0, 12],
        [1, 3],
        [2, 1],
      ]);
      expect(hits.every((h) => h.matchedToken === 'hello')).toBe(true);
    });

    it('searchTerm_multi_token_AND_one_hit_per_page — both tokens on same page → one hit; different pages → no hits', async () => {
      const sharedPage: InvertedIndex = {
        alpha: [
          [0, 1],
          [1, 2],
        ],
        beta: [
          [0, 5],
          [2, 3],
        ],
      };
      const source = await makeInitializedSource(envelope(sharedPage), {
        '0001': textJson([{ text: 'x' }]),
      });

      const both = await source.searchTerm('alpha beta');
      // Only page 0 has both tokens.
      expect(both).toHaveLength(1);
      expect(both[0].pageIndex).toBe(0);
      expect(both[0].itemIndex).toBe(1); // First-occurrence itemIndex of FIRST token (alpha).
      expect(both[0].matchedToken).toBe('alpha');

      const disjointIndex: InvertedIndex = {
        cat: [[0, 1]],
        dog: [[1, 1]],
      };
      const source2 = await makeInitializedSource(envelope(disjointIndex));
      const noShared = await source2.searchTerm('cat dog');
      expect(noShared).toEqual([]);
    });

    it('searchTerm_empty_query_returns_empty_array — empty + whitespace-only inputs return []', async () => {
      const source = await makeInitializedSource(envelope({ a: [[0, 0]] }));
      expect(await source.searchTerm('')).toEqual([]);
      expect(await source.searchTerm('   ')).toEqual([]);
      expect(await source.searchTerm('\t\n  \t')).toEqual([]);
      // All-punctuation query also returns [] (tokenizes to nothing).
      expect(await source.searchTerm('!!!---???')).toEqual([]);
    });

    it('searchTerm_handles_legacy_placeholder_bundle_gracefully — `{}` and 404 both return []', async () => {
      const source = await makeInitializedSource({} as Record<string, unknown>);
      expect(await source.searchTerm('anything')).toEqual([]);

      const source404 = await makeInitializedSource(null);
      expect(await source404.searchTerm('anything')).toEqual([]);

      // Manifest with no `documentArtifacts.search` at all → legacy
      const noSearchArtifact = await makeInitializedSource(envelope({}), {}, {
        documentArtifacts: { outline: 'outline.json' },
      });
      expect(await noSearchArtifact.searchTerm('anything')).toEqual([]);
    });
  });

  describe('defensive checks', () => {
    it('searchTerm_rejects_wrong_format_search_json_with_clear_error', async () => {
      // EXPECTED_FORMAT is 'inverted' (Phase D winner). A bundle declaring
      // 'sorted' must throw with the diagnostic upgrade-path message.
      const wrong = envelope({}, { format: 'sorted' });
      const source = await makeInitializedSource(wrong);
      await expect(source.searchTerm('x')).rejects.toThrow(
        /format mismatch: adapter expects 'inverted', bundle declares 'sorted'/,
      );
    });

    it('searchTerm_rejects_non_envelope_search_json_with_clear_error — array/null/primitive', async () => {
      const sourceArr = await makeInitializedSource([1, 2, 3] as unknown as Record<string, unknown>);
      await expect(sourceArr.searchTerm('x')).rejects.toThrow(
        /search\.json shape invalid: expected plain object envelope, got array/,
      );

      // Null body → custom routes (jsonResponse(null) would 200 with "null").
      mockFetchRouter({
        'manifest.json': () => jsonResponse(makeManifestObject()),
        'search.json': () => jsonResponse(null),
      });
      const source2 = new PreRenderedPageSource({ bundleUrl: '/bundle' });
      await source2.init();
      await expect(source2.searchTerm('x')).rejects.toThrow(
        /search\.json shape invalid: expected plain object envelope, got null/,
      );
    });

    it('searchTerm_contextSnippet_has_no_html_active_chars — XSS defense-in-depth strips < > & \' " `', async () => {
      const index: InvertedIndex = { hello: [[0, 2]] };
      const dangerous = '<script>alert("xss")</script>&amp;`back-tick`\'sq"dq';
      const items = [...dangerous].map((c) => ({ text: c }));
      // Move the hit's itemIndex to point at "hello" — synthesize: items prefix +
      // 'hello' chars + items suffix. The test asserts strip, not match content.
      items.splice(0, 0, { text: 'h' }, { text: 'e' }, { text: 'l' }, { text: 'l' }, { text: 'o' });
      const source = await makeInitializedSource(envelope(index), {
        '0001': textJson(items),
      });

      const hits = await source.searchTerm('hello');
      expect(hits).toHaveLength(1);
      // Every char of `<>&'"\`` MUST be absent from the snippet.
      expect(hits[0].contextSnippet).not.toMatch(/[<>&'"`]/);
    });

    it('searchTerm_honors_AbortSignal — pre-aborted + mid-flight abort both reject with AbortError', async () => {
      const index: InvertedIndex = { hello: [[0, 0]] };
      const source = await makeInitializedSource(envelope(index), {
        '0001': textJson([{ text: 'h' }, { text: 'i' }]),
      });

      // Pre-aborted.
      const pre = new AbortController();
      pre.abort();
      await expect(source.searchTerm('hello', { signal: pre.signal })).rejects.toThrow(
        /aborted|AbortError/,
      );

      // Mid-flight abort: install fetch that resolves search.json normally
      // but never resolves the text.json fetch. Abort mid-promise.
      mockFetchRouter({
        'manifest.json': () => jsonResponse(makeManifestObject()),
        'search.json': () => jsonResponse(envelope(index)),
        'pages/0001/text.json': () => new Promise<Response>(() => {}),
      });
      const source2 = new PreRenderedPageSource({ bundleUrl: '/bundle' });
      await source2.init();
      const mid = new AbortController();
      const p = source2.searchTerm('hello', { signal: mid.signal });
      setTimeout(() => mid.abort(), 10);
      // Native fetch with an aborted signal throws AbortError synchronously
      // on next event loop turn; the rejection here proves the signal is
      // threaded into the snippet fetch.
      await expect(p).rejects.toThrow(/aborted|AbortError/);
    });
  });

  describe('cache + warn-once', () => {
    it('dispose_clears_search_index_state — cache + warn-flags + warn-set all empty/false after dispose', async () => {
      const index: InvertedIndex = { hello: [[0, 0]] };
      const env = envelope(index, {
        errors: [{ page_index: 1, code: 'extraction_timeout', message: 'cap' }],
      });
      const source = await makeInitializedSource(env, {
        '0001': textJson([{ text: 'h' }, { text: 'i' }]),
      });

      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await source.searchTerm('hello');

      // Sanity: state populated.
      const inner = source as unknown as {
        pageTextCache: Map<number, Promise<unknown>>;
        warnedAboutSearchErrors: boolean;
        warnedFailedSnippetPages: Set<number>;
      };
      expect(inner.pageTextCache.size).toBeGreaterThan(0);
      expect(inner.warnedAboutSearchErrors).toBe(true);

      source.dispose();

      expect(inner.pageTextCache.size).toBe(0);
      expect(inner.warnedAboutSearchErrors).toBe(false);
      expect(inner.warnedFailedSnippetPages.size).toBe(0);
      // Subsequent searchTerm fails because requireInit() throws.
      await expect(source.searchTerm('x')).rejects.toThrow(/disposed/);
    });

    it('loadPageTextForSnippet_warns_once_per_failed_page — each failure kind warns once per page', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Bundle: index has hits on page 0 + page 1; page 0 text.json 404s,
      // page 1 text.json returns malformed shape (no items array).
      const index: InvertedIndex = { hello: [[0, 0], [1, 0]] };
      mockFetchRouter({
        'manifest.json': () => jsonResponse(makeManifestObject()),
        'search.json': () => jsonResponse(envelope(index)),
        'pages/0001/text.json': () => new Response('', { status: 404 }),
        'pages/0002/text.json': () => jsonResponse({ notItems: 'bad' }),
      });
      const source = new PreRenderedPageSource({ bundleUrl: '/bundle' });
      await source.init();

      await source.searchTerm('hello');
      const firstCallCount = warnSpy.mock.calls.length;
      // 2 unique pages → 2 warns. Repeated searches must NOT spam.
      expect(firstCallCount).toBe(2);

      await source.searchTerm('hello');
      await source.searchTerm('hello');
      expect(warnSpy.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('adversarial input', () => {
    it('searchTerm_handles_pathologically_long_query_without_hanging — 100 KB query throws cap, 1023-char query returns', async () => {
      const source = await makeInitializedSource(envelope({}));

      // 100 KB query: throws synchronously (within 50 ms — no quadratic blowup).
      const huge = 'a'.repeat(100_000);
      const t0 = performance.now();
      await expect(source.searchTerm(huge)).rejects.toThrow(/exceeds 1024-char cap/);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(50);

      // 1023-char (one less than cap): no throw, returns [] cleanly.
      const just_under = 'a'.repeat(1023);
      const result = await source.searchTerm(just_under);
      expect(result).toEqual([]);
    });
  });
});
