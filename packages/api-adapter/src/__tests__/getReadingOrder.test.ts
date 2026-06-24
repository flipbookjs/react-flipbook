/**
 * Step 8b Phase B — adapter `getReadingOrder()` test suite. Mocks `fetch`
 * to serve synthetic manifests + reading-order.json envelopes without
 * needing real bundles on disk. Each test sets up its own fetch mock
 * matching URL patterns; the bundle-fixture approach (as in the existing
 * `fixtures/doc_smoke_3pg/`) is reserved for E2E (the Phase C H.5
 * roundtrip script).
 *
 * Test labels mirror step-8b-reading-order.md §6 acceptance-gate list 1:1.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreRenderedPageSource } from '../PreRenderedPageSource';
import type { Manifest, ReadingOrder } from '../PreRenderedPageSource';

// ---- Fixture helpers ----

function makeManifestObject(
  overrides: Partial<Manifest> = {},
): Record<string, unknown> {
  return {
    manifestVersion: 1,
    documentId: 'doc_test',
    contentHash: 'sha256:abc',
    status: 'ready',
    generatedAt: '2026-06-24T00:00:00Z',
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
 * Construct a well-formed v1 passthrough envelope with one paragraph block
 * covering `n` items. Tests overlay overrides onto this to construct the
 * malformed shapes that the rejection paths exercise.
 */
function wellFormedEnvelope(
  n: number,
  overrides: Partial<ReadingOrder> = {},
): Record<string, unknown> {
  return {
    serializationVersion: 1,
    source: 'passthrough',
    blocks: [
      {
        kind: 'paragraph',
        itemRange: [0, n],
        rect: [10.5, 20.3, 200.0, 110.4],
      },
    ],
    order: [0],
    errors: [],
    ...overrides,
  };
}

/**
 * Route incoming fetches to per-URL handlers. Mirrors searchTerm.test.ts:93
 * exactly — same shape, same abort-signal plumbing — so the adapter's
 * fetch path behaves identically in mock and production. Each handler
 * returns a Response (or a Promise of one). Unmatched URLs reject with
 * a descriptive error so test failures point at the missing handler.
 */
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
            const onAbort = () =>
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

/**
 * Construct + init a PreRenderedPageSource with the given reading-order
 * response for page 1 (pages/0001/reading-order.json). Pass `null` to
 * simulate a 404, or a body object to serve as the envelope JSON.
 */
async function makeInitializedSource(
  body: Record<string, unknown> | null,
): Promise<PreRenderedPageSource> {
  mockFetchRouter({
    'manifest.json': () => jsonResponse(makeManifestObject()),
    'pages/0001/reading-order.json': () =>
      body === null ? new Response('', { status: 404 }) : jsonResponse(body),
  });
  const source = new PreRenderedPageSource({ bundleUrl: '/bundle' });
  await source.init();
  return source;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================
// 8b Phase B — getReadingOrder tests
// ============================================================

describe('PreRenderedPageSource.getReadingOrder', () => {
  // Label: getReadingOrder_returns_passthrough_for_well_formed_bundle
  it('returns passthrough for a well-formed bundle', async () => {
    const source = await makeInitializedSource(wellFormedEnvelope(9));
    const ro = await source.getReadingOrder(0);
    expect(ro.serializationVersion).toBe(1);
    expect(ro.source).toBe('passthrough');
    expect(ro.blocks).toHaveLength(1);
    expect(ro.blocks[0].kind).toBe('paragraph');
    expect(ro.blocks[0].itemRange).toEqual([0, 9]);
    expect(ro.blocks[0].items).toBeUndefined();
    expect(ro.blocks[0].rect).toEqual([10.5, 20.3, 200.0, 110.4]);
    expect(ro.order).toEqual([0]);
    expect(ro.errors).toEqual([]);
  });

  // Label: getReadingOrder_handles_legacy_placeholder_bundle_gracefully (404 + {} cases)
  it('handles legacy placeholder bundle gracefully (404 + empty object)', async () => {
    // 404 path → LEGACY_READING_ORDER
    {
      const source = await makeInitializedSource(null);
      const ro = await source.getReadingOrder(0);
      expect(ro).toEqual({
        serializationVersion: 1,
        source: 'passthrough',
        blocks: [],
        order: [],
        errors: [],
      });
    }
    // {} placeholder path → LEGACY_READING_ORDER
    {
      vi.restoreAllMocks();
      const source = await makeInitializedSource({});
      const ro = await source.getReadingOrder(0);
      expect(ro).toEqual({
        serializationVersion: 1,
        source: 'passthrough',
        blocks: [],
        order: [],
        errors: [],
      });
    }
  });

  // Label: getReadingOrder_rejects_wrong_serialization_version_with_clear_error
  it('rejects wrong serializationVersion with a clear error', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(3),
      serializationVersion: 2,
    });
    await expect(source.getReadingOrder(0)).rejects.toThrow(
      /serializationVersion mismatch.*adapter expects 1.*bundle declares 2/,
    );
  });

  // Label: getReadingOrder_rejects_non_object_shape_with_clear_error
  it('rejects non-object shape with a clear error', async () => {
    // Array body → rejected as "not a plain object"
    mockFetchRouter({
      'manifest.json': () => jsonResponse(makeManifestObject()),
      'pages/0001/reading-order.json': () => jsonResponse([1, 2, 3]),
    });
    const source = new PreRenderedPageSource({ bundleUrl: '/bundle' });
    await source.init();
    await expect(source.getReadingOrder(0)).rejects.toThrow(
      /not a plain object/,
    );
  });

  // Label: getReadingOrder_rejects_unknown_source_with_clear_error
  it('rejects unknown source with a clear error', async () => {
    const source = await makeInitializedSource({
      ...wellFormedEnvelope(3),
      source: 'magic',
    });
    await expect(source.getReadingOrder(0)).rejects.toThrow(
      /'source' must be 'passthrough' \| 'structtree' \| 'heuristic'/,
    );
  });

  // Label: getReadingOrder_rejects_block_with_both_itemrange_and_items
  it('rejects block with both itemRange and items', async () => {
    const source = await makeInitializedSource({
      serializationVersion: 1,
      source: 'passthrough',
      blocks: [
        {
          kind: 'paragraph',
          itemRange: [0, 3],
          items: [0, 1, 2],
          rect: [0, 0, 100, 50],
        },
      ],
      order: [0],
      errors: [],
    });
    await expect(source.getReadingOrder(0)).rejects.toThrow(
      /blocks\[0\] has both itemRange and items.*mutually exclusive/,
    );
  });

  // Label: getReadingOrder_rejects_block_with_neither_itemrange_nor_items
  it('rejects block with neither itemRange nor items', async () => {
    const source = await makeInitializedSource({
      serializationVersion: 1,
      source: 'passthrough',
      blocks: [{ kind: 'paragraph', rect: [0, 0, 100, 50] }],
      order: [0],
      errors: [],
    });
    await expect(source.getReadingOrder(0)).rejects.toThrow(
      /blocks\[0\] has neither itemRange nor items.*exactly one required/,
    );
  });

  // Label: getReadingOrder_rejects_non_integer_itemrange_values
  it('rejects non-integer itemRange values', async () => {
    const source = await makeInitializedSource({
      serializationVersion: 1,
      source: 'passthrough',
      blocks: [
        {
          kind: 'paragraph',
          itemRange: [0, 3.5],
          rect: [0, 0, 100, 50],
        },
      ],
      order: [0],
      errors: [],
    });
    await expect(source.getReadingOrder(0)).rejects.toThrow(
      /blocks\[0\]\.itemRange must be \[start, endExclusive\] of non-negative integers/,
    );
  });

  // Label: getReadingOrder_rejects_out_of_range_order_index
  it('rejects out-of-range order index', async () => {
    const source = await makeInitializedSource({
      serializationVersion: 1,
      source: 'passthrough',
      blocks: [
        {
          kind: 'paragraph',
          itemRange: [0, 3],
          rect: [0, 0, 100, 50],
        },
      ],
      order: [0, 5], // 5 >= blocks.length (=1) → reject
      errors: [],
    });
    await expect(source.getReadingOrder(0)).rejects.toThrow(
      /order\[1\] must be a non-negative integer < blocks\.length/,
    );
  });

  // Label: getReadingOrder_honors_AbortSignal (pre-aborted + mid-flight)
  it('honors AbortSignal (pre-aborted + mid-flight)', async () => {
    // Pre-aborted: the function MUST throw before issuing the fetch.
    {
      const source = await makeInitializedSource(wellFormedEnvelope(3));
      const controller = new AbortController();
      controller.abort();
      await expect(
        source.getReadingOrder(0, { signal: controller.signal }),
      ).rejects.toThrow(/aborted/);
    }
    // Mid-flight: signal aborts while the fetch is in flight; mock router
    // wires the signal into its pending promise so the abort propagates.
    {
      vi.restoreAllMocks();
      let resolveFetch: (r: Response) => void = () => {};
      mockFetchRouter({
        'manifest.json': () => jsonResponse(makeManifestObject()),
        'pages/0001/reading-order.json': () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      });
      const source = new PreRenderedPageSource({ bundleUrl: '/bundle' });
      await source.init();
      const controller = new AbortController();
      const promise = source.getReadingOrder(0, { signal: controller.signal });
      controller.abort();
      await expect(promise).rejects.toThrow(/aborted/);
      // Free the pending promise so the test runner doesn't leak it.
      resolveFetch(jsonResponse(wellFormedEnvelope(3)));
    }
  });
});
