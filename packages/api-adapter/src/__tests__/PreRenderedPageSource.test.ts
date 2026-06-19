/**
 * G6 — adapter suite per the plan's enumerated test list. 42 it() blocks
 * covering init / getPageSize&Count / renderPage scale-selection / abort /
 * canvas-area guard / bounds check / scale validation / concurrency limiter /
 * bundleUrl normalization / sidecars / getSourceUrl / dispose.
 *
 * Fetch is mocked via vi.spyOn(globalThis, 'fetch'). createImageBitmap is
 * stubbed (jsdom doesn't ship it). Canvas operations use jsdom's stub —
 * tests verify dimensions and presence, not pixel content.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreRenderedPageSource } from '../PreRenderedPageSource';
import type { Manifest } from '../PreRenderedPageSource';

// ---- Fixture helpers ----

function makeManifestObject(overrides: Partial<Manifest> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    documentId: 'doc_test',
    contentHash: 'sha256:abc',
    status: 'ready',
    generatedAt: '2026-06-14T00:00:00Z',
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

function manifestResponse(manifest: Record<string, unknown>): Response {
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Returns a minimal Response usable as a tier-fetch result. The body is an
 * ArrayBuffer (avoids jsdom's Blob → Response interop bug where
 * `object.stream is not a function`). The adapter calls `.blob()` on the
 * Response and passes the resulting Blob to (stubbed) `createImageBitmap`;
 * tests don't decode the bytes, just confirm the path.
 */
function imageResponse(): Response {
  return new Response(new Uint8Array(36).buffer, {
    status: 200,
    headers: { 'content-type': 'image/webp' },
  });
}

interface StubBitmap {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}

/**
 * Stub createImageBitmap (not implemented in jsdom). Returns an object with
 * width/height/close — sufficient for the adapter's drawImage and cleanup
 * paths since the canvas stub treats drawImage as a no-op.
 */
function stubCreateImageBitmap(opts: { close?: () => void; width?: number; height?: number; throwOnDecode?: boolean } = {}): {
  bitmap: StubBitmap;
  mock: ReturnType<typeof vi.fn>;
} {
  const bitmap: StubBitmap = {
    width: opts.width ?? 100,
    height: opts.height ?? 100,
    close: vi.fn(opts.close ?? (() => {})),
  };
  const mock = vi.fn(async () => {
    if (opts.throwOnDecode) throw new Error('createImageBitmap failed');
    return bitmap;
  });
  vi.stubGlobal('createImageBitmap', mock);
  return { bitmap, mock };
}

// ---- Cleanup ----

/**
 * jsdom's noop canvas exposes `getContext` but rejects non-recognized inputs
 * to `drawImage` with `TypeError: Image or Canvas expected`. Our stubbed
 * ImageBitmap is a plain object. We don't have access to
 * `CanvasRenderingContext2D` as a global (jsdom doesn't expose it), so we
 * patch `getContext` at the prototype level — every time the adapter creates
 * a canvas and calls getContext, we replace the returned context's
 * `drawImage` with a controllable mock. `drawImageMock` is module-level so
 * individual tests (notably the Rule 6 "drawImage throws" test) can override
 * its implementation.
 */
let drawImageMock: ReturnType<typeof vi.fn>;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  stubCreateImageBitmap();
  drawImageMock = vi.fn();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
    let ctx = (originalGetContext as (...a: unknown[]) => unknown).apply(this, args);
    // jsdom returns null for getContext (no canvas implementation); the
    // viewer's CurlOverlay degraded-mode detection relies on that, so we
    // can't globally polyfill it. Local to THIS test file (which exercises
    // the api-adapter's renderPage path that requires a real-ish 2D
    // context), substitute a minimal stub object when jsdom returns null.
    if (ctx === null && args[0] === '2d') {
      ctx = {
        canvas: this,
        drawImage: () => {},
        clearRect: () => {},
        fillRect: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        scale: () => {},
        setTransform: () => {},
        resetTransform: () => {},
      };
    }
    if (ctx && typeof ctx === 'object' && 'drawImage' in ctx) {
      (ctx as { drawImage: typeof drawImageMock }).drawImage = drawImageMock;
    }
    return ctx as ReturnType<HTMLCanvasElement['getContext']>;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---- Tests ----

describe('PreRenderedPageSource', () => {
  describe('init', () => {
    it('rejects on manifest 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404, statusText: 'Not Found' }));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await expect(source.init()).rejects.toThrow(/Failed to load manifest at \/b\/manifest\.json: 404 Not Found/);
    });

    it('rejects on manifest that fails validateManifest (D14)', async () => {
      const bad = makeManifestObject({ manifestVersion: 2 as unknown as Manifest['manifestVersion'] });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(manifestResponse(bad));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await expect(source.init()).rejects.toThrow(/manifestVersion/);
    });

    it('rejects when manifest.status !== "ready"', async () => {
      const pending = makeManifestObject({ status: 'pending' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(manifestResponse(pending));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await expect(source.init()).rejects.toThrow(/Document not ready: pending/);
    });

    it('rejects with descriptive error when manifest body is not valid JSON (200 + HTML body case)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<!DOCTYPE html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await expect(source.init()).rejects.toThrow(/is not valid JSON/);
    });

    it('rejects with "Manifest fetch timeout" when fetch exceeds INIT_TIMEOUT_MS (house-rules Rule 2)', async () => {
      vi.useFakeTimers();
      // fetch returns a promise that never resolves
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      const initPromise = source.init();
      // Attach a no-op catch BEFORE advancing timers — prevents a brief
      // "unhandled rejection" window between Promise.race firing and the
      // outer `await expect().rejects.toThrow(...)` consuming the rejection
      // (vitest fake-timers + Promise.race microtask ordering quirk).
      const captured = initPromise.catch((err: Error) => err);
      await vi.advanceTimersByTimeAsync(30_001);
      const err = await captured;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/Manifest fetch timeout after 30000ms for \/b\/manifest\.json/);
      vi.useRealTimers();
    });

    it('resolves and populates manifest on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(manifestResponse(makeManifestObject()));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      expect(source.getPageCount()).toBe(3);
    });
  });

  describe('getPageSize / getPageCount', () => {
    async function readyAdapter(): Promise<PreRenderedPageSource> {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(manifestResponse(makeManifestObject()));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      return source;
    }

    it('returns size from manifest.pages[i].size', async () => {
      const source = await readyAdapter();
      expect(source.getPageSize(0)).toEqual({ width: 594, height: 792 });
      expect(source.getPageSize(2)).toEqual({ width: 594, height: 792 });
    });

    it('throws when called before init', () => {
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      expect(() => source.getPageSize(0)).toThrow(/not initialized/);
      expect(() => source.getPageCount()).toThrow(/not initialized/);
    });

    it('throws RangeError with descriptive message when index < 0 (API-boundary bounds check)', async () => {
      const source = await readyAdapter();
      expect(() => source.getPageSize(-1)).toThrow(RangeError);
      expect(() => source.getPageSize(-1)).toThrow(/Page index -1 out of range \[0, 3\)/);
    });

    it('throws RangeError with descriptive message when index >= pageCount (API-boundary bounds check)', async () => {
      const source = await readyAdapter();
      expect(() => source.getPageSize(3)).toThrow(RangeError);
      expect(() => source.getPageSize(3)).toThrow(/Page index 3 out of range \[0, 3\)/);
    });
  });

  describe('renderPage scale selection (D3)', () => {
    async function readyAdapter(opts: { trackUrl?: (url: string) => void } = {}): Promise<PreRenderedPageSource> {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/manifest.json')) return manifestResponse(makeManifestObject());
        opts.trackUrl?.(url);
        return imageResponse();
      });
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      return source;
    }

    it('picks smallest tier >= requested width', async () => {
      let lastUrl = '';
      const source = await readyAdapter({ trackUrl: (u) => { lastUrl = u; } });
      // pageWidth=594, scale=2 → targetWidth=1188 → first tier >= 1188 is 2048.
      await source.renderPage(0, 2);
      expect(lastUrl).toMatch(/width-2048\.webp$/);
    });

    it('falls back to largest tier when request exceeds all', async () => {
      let lastUrl = '';
      const source = await readyAdapter({ trackUrl: (u) => { lastUrl = u; } });
      // pageWidth=594, scale=100 → targetWidth=59400 → exceeds 4096; fallback.
      await source.renderPage(0, 100);
      expect(lastUrl).toMatch(/width-4096\.webp$/);
    });

    it('uses override tier when present', async () => {
      let lastUrl = '';
      const manifestWithOverride = makeManifestObject({
        overrides: {
          '0001': { widths: [1024, 2048, 4096, 8192], tierUrls: { 8192: 'pages/0001/special-8192.webp' } },
        } as Manifest['overrides'],
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/manifest.json')) return manifestResponse(manifestWithOverride);
        lastUrl = url;
        return imageResponse();
      });
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      // scale=15 → targetWidth=8910 → first tier in override list >= 8910 is 8192 (only one).
      await source.renderPage(0, 15);
      expect(lastUrl).toBe('/b/pages/0001/special-8192.webp');
    });

    it('returns a FRESH HTMLCanvasElement per call (not pooled)', async () => {
      const source = await readyAdapter();
      const a = await source.renderPage(0, 1);
      const b = await source.renderPage(0, 1);
      expect(a).toBeInstanceOf(HTMLCanvasElement);
      expect(b).toBeInstanceOf(HTMLCanvasElement);
      expect(a).not.toBe(b);
    });
  });

  describe('renderPage abort', () => {
    async function readyAdapter(): Promise<PreRenderedPageSource> {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/manifest.json')) return manifestResponse(makeManifestObject());
        // For tier fetches, respect the abort signal: reject with AbortError
        // if signal is aborted at fetch time.
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return imageResponse();
      });
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      return source;
    }

    it('rejects with AbortError when signal fires before fetch', async () => {
      const source = await readyAdapter();
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(source.renderPage(0, 1, ctrl.signal)).rejects.toThrow(/aborted/);
    });

    it('rejects with AbortError when signal fires mid-fetch', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/manifest.json')) return manifestResponse(makeManifestObject());
        // Hang until signal aborts, then throw.
        await new Promise<void>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          setTimeout(resolve, 5000);
        });
        return imageResponse();
      });
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      const ctrl = new AbortController();
      const promise = source.renderPage(0, 1, ctrl.signal);
      // Abort on next microtask to give the fetch a chance to start.
      Promise.resolve().then(() => ctrl.abort());
      await expect(promise).rejects.toThrow(/aborted/);
    });
  });

  describe('renderPage canvas-area guard (F7)', () => {
    async function readyAdapter(): Promise<PreRenderedPageSource> {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/manifest.json')) return manifestResponse(makeManifestObject());
        return imageResponse();
      });
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      return source;
    }

    it('clamps backing-store dimensions when pageW * pageH * scale^2 exceeds MAX_CANVAS_SIZE', async () => {
      const source = await readyAdapter();
      // pageW=594, pageH=792. MAX_CANVAS_SIZE = 4096^2 = 16777216.
      // maxScale = sqrt(16777216 / (594*792)) = sqrt(35.66) ≈ 5.97
      // Mirrors PdfjsSource.ts:118 — guard limits AREA, not individual
      // dimensions. Non-square aspect ratios can produce one dimension
      // larger than 4096 as long as the product stays under the cap.
      const canvas = await source.renderPage(0, 100);
      expect(canvas.width * canvas.height).toBeLessThanOrEqual(4096 * 4096);
      // Without the guard, dimensions would be 594*100=59400 × 792*100=79200,
      // far above the cap. With the guard, both should be much smaller.
      expect(canvas.width).toBeLessThan(594 * 100);
      expect(canvas.height).toBeLessThan(792 * 100);
    });

    it('returns canvas at requested scale when below the limit', async () => {
      const source = await readyAdapter();
      // scale=2 → canvas should be 594*2=1188 × 792*2=1584. Well below limit.
      const canvas = await source.renderPage(0, 2);
      expect(canvas.width).toBe(1188);
      expect(canvas.height).toBe(1584);
    });

    it('closes the ImageBitmap when ctx.drawImage throws (Rule 6 — no leak on throw)', async () => {
      const { bitmap } = stubCreateImageBitmap();
      // Override the beforeEach drawImage mock to throw.
      drawImageMock.mockImplementation(() => {
        throw new Error('simulated drawImage failure');
      });
      const source = await readyAdapter();
      await expect(source.renderPage(0, 1)).rejects.toThrow(/simulated drawImage failure/);
      expect(bitmap.close).toHaveBeenCalled();
    });
  });

  describe('renderPage bounds check', () => {
    async function readyAdapter(): Promise<PreRenderedPageSource> {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(manifestResponse(makeManifestObject()));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      return source;
    }

    it('throws RangeError when index < 0', async () => {
      const source = await readyAdapter();
      await expect(source.renderPage(-1, 1)).rejects.toThrow(RangeError);
      await expect(source.renderPage(-1, 1)).rejects.toThrow(/out of range/);
    });

    it('throws RangeError when index >= pageCount', async () => {
      const source = await readyAdapter();
      await expect(source.renderPage(3, 1)).rejects.toThrow(RangeError);
      await expect(source.renderPage(3, 1)).rejects.toThrow(/out of range/);
    });
  });

  describe('renderPage scale validation (EC1)', () => {
    async function readyAdapter(): Promise<PreRenderedPageSource> {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(manifestResponse(makeManifestObject()));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      return source;
    }

    it('throws RangeError when scale is 0', async () => {
      const source = await readyAdapter();
      await expect(source.renderPage(0, 0)).rejects.toThrow(/scale must be a positive finite number/);
    });

    it('throws RangeError when scale is negative', async () => {
      const source = await readyAdapter();
      await expect(source.renderPage(0, -1)).rejects.toThrow(/scale must be a positive finite number/);
    });

    it('throws RangeError when scale is NaN', async () => {
      const source = await readyAdapter();
      await expect(source.renderPage(0, NaN)).rejects.toThrow(/scale must be a positive finite number/);
    });

    it('throws RangeError when scale is Infinity', async () => {
      const source = await readyAdapter();
      await expect(source.renderPage(0, Infinity)).rejects.toThrow(/scale must be a positive finite number/);
    });
  });

  describe('renderPage concurrency limiter (mirrors PdfjsSource)', () => {
    /**
     * Helper to create an adapter whose tier-fetch hangs until resolved by
     * the test. Returns the source + a resolver array (one resolver per
     * tier fetch issued).
     */
    async function readyAdapterWithControlledFetch(): Promise<{ source: PreRenderedPageSource; release: (() => void)[] }> {
      const release: (() => void)[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/manifest.json')) return manifestResponse(makeManifestObject());
        // tier fetch: hang until released.
        return new Promise<Response>((resolve) => {
          release.push(() => resolve(imageResponse()));
        });
      });
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      return { source, release };
    }

    it('allows up to maxConcurrentRenders (3) in flight simultaneously', async () => {
      const { source, release } = await readyAdapterWithControlledFetch();
      // Start 3 renders. They should all be in-flight (waiting for release).
      const p1 = source.renderPage(0, 1);
      const p2 = source.renderPage(1, 1);
      const p3 = source.renderPage(2, 1);
      // Microtask flush so fetches start.
      await new Promise((r) => setTimeout(r, 0));
      expect(release).toHaveLength(3);
      // Release all so test cleans up.
      release.forEach((r) => r());
      await Promise.all([p1, p2, p3]);
    });

    it('queues the 4th+ renderPage call until a slot frees', async () => {
      const { source, release } = await readyAdapterWithControlledFetch();
      const p1 = source.renderPage(0, 1);
      const p2 = source.renderPage(1, 1);
      const p3 = source.renderPage(2, 1);
      const p4 = source.renderPage(0, 1); // 4th — should queue.
      await new Promise((r) => setTimeout(r, 0));
      // Only 3 fetches started — 4th is queued behind the limiter.
      expect(release).toHaveLength(3);
      // Release first → 4th's fetch should start.
      release[0]();
      await p1;
      await new Promise((r) => setTimeout(r, 0));
      expect(release).toHaveLength(4);
      release[1]();
      release[2]();
      release[3]();
      await Promise.all([p2, p3, p4]);
    });

    it('aborting a queued waiter removes it from the queue and rejects with AbortError', async () => {
      const { source, release } = await readyAdapterWithControlledFetch();
      const p1 = source.renderPage(0, 1);
      const p2 = source.renderPage(1, 1);
      const p3 = source.renderPage(2, 1);
      const ctrl = new AbortController();
      const p4 = source.renderPage(0, 1, ctrl.signal); // queued
      await new Promise((r) => setTimeout(r, 0));
      ctrl.abort();
      await expect(p4).rejects.toThrow(/cancelled|aborted/i);
      // Other 3 still in flight; release to clean up.
      release.forEach((r) => r());
      await Promise.all([p1, p2, p3]);
    });

    it('dispose() rejects every queued waiter with a "disposed while queued" error', async () => {
      const { source, release } = await readyAdapterWithControlledFetch();
      const p1 = source.renderPage(0, 1);
      const p2 = source.renderPage(1, 1);
      const p3 = source.renderPage(2, 1);
      const p4 = source.renderPage(0, 1); // queued
      await new Promise((r) => setTimeout(r, 0));
      source.dispose();
      await expect(p4).rejects.toThrow(/disposed while.*queued/);
      // First 3 fetches were already started by the limiter; they'll complete
      // when released, but the canvas they return is discarded by the caller.
      release.forEach((r) => r());
      // Suppress unhandled rejections from p1-p3 by attaching a no-op catch.
      await Promise.allSettled([p1, p2, p3]);
    });
  });

  describe('constructor bundleUrl normalization (EC2)', () => {
    it('strips a single trailing slash', async () => {
      let manifestUrl = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        manifestUrl = url;
        return manifestResponse(makeManifestObject());
      });
      const source = new PreRenderedPageSource({ bundleUrl: 'https://cdn.example/' });
      await source.init();
      expect(manifestUrl).toBe('https://cdn.example/manifest.json');
    });

    it('strips multiple trailing slashes', async () => {
      let manifestUrl = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        manifestUrl = url;
        return manifestResponse(makeManifestObject());
      });
      const source = new PreRenderedPageSource({ bundleUrl: 'https://cdn.example///' });
      await source.init();
      expect(manifestUrl).toBe('https://cdn.example/manifest.json');
    });

    it('leaves a slash-less URL unchanged', async () => {
      let manifestUrl = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        manifestUrl = url;
        return manifestResponse(makeManifestObject());
      });
      const source = new PreRenderedPageSource({ bundleUrl: 'https://cdn.example' });
      await source.init();
      expect(manifestUrl).toBe('https://cdn.example/manifest.json');
    });

    it('accepts a URL instance and converts to string', async () => {
      let manifestUrl = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        manifestUrl = url;
        return manifestResponse(makeManifestObject());
      });
      const source = new PreRenderedPageSource({ bundleUrl: new URL('https://cdn.example/bundle/') });
      await source.init();
      expect(manifestUrl).toBe('https://cdn.example/bundle/manifest.json');
    });
  });

  describe('sidecars (D8 split failure model)', () => {
    async function readyAdapterWithSidecar(opts: {
      sidecarResponse: () => Response | Promise<Response>;
    }): Promise<PreRenderedPageSource> {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/manifest.json')) return manifestResponse(makeManifestObject());
        if (url.includes('outline.json') || url.includes('text.json') || url.includes('links.json')) {
          return opts.sidecarResponse();
        }
        return new Response('', { status: 404 });
      });
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      return source;
    }

    it('getTextContent returns parsed items array on 200', async () => {
      const source = await readyAdapterWithSidecar({
        sidecarResponse: () => new Response(JSON.stringify({ items: [{ text: 'hi', x: 0, y: 0, width: 10, height: 10 }] }), { status: 200 }),
      });
      const items = await source.getTextContent(0);
      expect(items).toEqual([{ text: 'hi', x: 0, y: 0, width: 10, height: 10 }]);
    });

    it('getLinks returns parsed links array on 200', async () => {
      const source = await readyAdapterWithSidecar({
        sidecarResponse: () => new Response(JSON.stringify({ links: [{ rect: [0, 0, 10, 10], url: 'https://x.com' }] }), { status: 200 }),
      });
      const links = await source.getLinks(0);
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe('https://x.com');
    });

    it('getOutline reads documentArtifacts.outline path on 200', async () => {
      const source = await readyAdapterWithSidecar({
        sidecarResponse: () => new Response(JSON.stringify({ items: [{ title: 'Intro', pageIndex: 0 }] }), { status: 200 }),
      });
      const items = await source.getOutline();
      expect(items).toEqual([{ title: 'Intro', pageIndex: 0 }]);
    });

    it('returns empty array on sidecar 404 (legitimate absence — graceful degradation)', async () => {
      const source = await readyAdapterWithSidecar({
        sidecarResponse: () => new Response('', { status: 404 }),
      });
      expect(await source.getTextContent(0)).toEqual([]);
      expect(await source.getLinks(0)).toEqual([]);
      expect(await source.getOutline()).toEqual([]);
    });

    it('THROWS on sidecar 5xx (server error — fail loud per Rule 1)', async () => {
      const source = await readyAdapterWithSidecar({
        sidecarResponse: () => new Response('boom', { status: 502, statusText: 'Bad Gateway' }),
      });
      await expect(source.getTextContent(0)).rejects.toThrow(/Sidecar fetch failed \(502 Bad Gateway\)/);
      await expect(source.getLinks(0)).rejects.toThrow(/Sidecar fetch failed \(502 Bad Gateway\)/);
      await expect(source.getOutline()).rejects.toThrow(/Outline fetch failed \(502 Bad Gateway\)/);
    });

    it('THROWS on sidecar network error (offline / DNS fail — fail loud per Rule 1)', async () => {
      const source = await readyAdapterWithSidecar({
        sidecarResponse: () => { throw new TypeError('fetch failed'); },
      });
      await expect(source.getTextContent(0)).rejects.toThrow(/fetch failed/);
    });
  });

  describe('getSourceUrl (D11)', () => {
    it('returns resolved URL when documentArtifacts.sourcePdf is set', async () => {
      const m = makeManifestObject({ documentArtifacts: { outline: 'outline.json', sourcePdf: 'source.pdf' } });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(manifestResponse(m));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      expect(source.getSourceUrl()).toBe('/b/source.pdf');
    });

    it('returns undefined when documentArtifacts.sourcePdf is absent', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(manifestResponse(makeManifestObject()));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      expect(source.getSourceUrl()).toBeUndefined();
    });
  });

  describe('dispose', () => {
    it('throws on subsequent method calls after dispose', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(manifestResponse(makeManifestObject()));
      const source = new PreRenderedPageSource({ bundleUrl: '/b' });
      await source.init();
      source.dispose();
      expect(() => source.getPageCount()).toThrow(/has been disposed/);
      expect(() => source.getPageSize(0)).toThrow(/has been disposed/);
      await expect(source.renderPage(0, 1)).rejects.toThrow(/has been disposed/);
    });
  });
});
