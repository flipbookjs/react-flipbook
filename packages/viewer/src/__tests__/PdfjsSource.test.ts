// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PdfjsSource } from '../adapters/PdfjsSource';

// Mock pdfjs-dist — renderPage tests must use mock canvases in Node (Week 0 finding)
vi.mock('pdfjs-dist', () => {
  const mockRenderTask = {
    promise: Promise.resolve(),
    cancel: vi.fn(),
  };

  const mockPage = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
      // Default identity — tests that need rotation/flip semantics override
      // getViewport via mockReturnValueOnce to return a shape with a specific
      // convertToViewportRectangle behavior.
      convertToViewportRectangle: vi.fn((rect: number[]) => rect),
    })),
    render: vi.fn(() => mockRenderTask),
    getAnnotations: vi.fn(() => Promise.resolve([])),
  };

  const mockDoc = {
    numPages: 3,
    getPage: vi.fn(() => Promise.resolve(mockPage)),
    destroy: vi.fn(),
    getDestination: vi.fn(),
    getPageIndex: vi.fn(),
  };

  return {
    getDocument: vi.fn(() => ({
      promise: Promise.resolve(mockDoc),
    })),
    GlobalWorkerOptions: { workerSrc: '' },
    // Runtime CDN-URL defaults in PdfjsSource.init() interpolate `pdfjs.version`.
    version: '5.6.205',
    _mockDoc: mockDoc,
    _mockPage: mockPage,
    _mockRenderTask: mockRenderTask,
  };
});

// Mock canvas — jsdom doesn't support getContext
const mockCtx = {} as CanvasRenderingContext2D;
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx);

let source: PdfjsSource;

beforeEach(() => {
  source = new PdfjsSource('https://example.com/test.pdf');
});

describe('PdfjsSource', () => {
  it('init() loads a PDF and caches page sizes', async () => {
    await source.init();
    expect(source.getPageCount()).toBe(3);
    expect(source.getPageSize(0)).toEqual({ width: 612, height: 792 });
  });

  it('init() throws if called twice', async () => {
    await source.init();
    await expect(source.init()).rejects.toThrow('PdfjsSource already initialized');
  });

  it('getPageCount() returns correct count', async () => {
    await source.init();
    expect(source.getPageCount()).toBe(3);
  });

  it('getPageCount() returns 0 before init', () => {
    expect(source.getPageCount()).toBe(0);
  });

  it('getPageSize(0) returns correct dimensions', async () => {
    await source.init();
    const size = source.getPageSize(0);
    expect(size.width).toBe(612);
    expect(size.height).toBe(792);
  });

  it('renderPage(0, 1.0) returns a canvas with correct dimensions', async () => {
    await source.init();
    const canvas = await source.renderPage(0, 1.0);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.width).toBe(612);
    expect(canvas.height).toBe(792);
  });

  it('renderPage throws if not initialized', async () => {
    await expect(source.renderPage(0, 1.0)).rejects.toThrow('PdfjsSource not initialized');
  });

  it('renderPage throws on invalid scale', async () => {
    await source.init();
    await expect(source.renderPage(0, 0)).rejects.toThrow('Invalid scale');
    await expect(source.renderPage(0, -1)).rejects.toThrow('Invalid scale');
    await expect(source.renderPage(0, NaN)).rejects.toThrow('Invalid scale');
  });

  it('renderPage with AbortSignal cancels correctly', async () => {
    await source.init();
    const controller = new AbortController();
    controller.abort();
    await expect(
      source.renderPage(0, 1.0, controller.signal),
    ).rejects.toThrow('Render cancelled');
  });

  it('dispose() cleans up without errors', async () => {
    await source.init();
    expect(() => source.dispose()).not.toThrow();
    expect(source.getPageCount()).toBe(0);
  });

  it('dispose() rejects queued renders', async () => {
    await source.init();

    // Fill all render slots
    const renders = [
      source.renderPage(0, 1.0),
      source.renderPage(1, 1.0),
      source.renderPage(2, 1.0),
    ];

    // Queue a 4th render (will be queued, not started)
    const queuedRender = source.renderPage(0, 1.0);

    // Dispose while render is queued
    source.dispose();

    await expect(queuedRender).rejects.toThrow('PdfjsSource disposed');

    // Let the started renders settle
    await Promise.allSettled(renders);
  });

  it('can be re-initialized after dispose', async () => {
    await source.init();
    expect(source.getPageCount()).toBe(3);
    source.dispose();
    expect(source.getPageCount()).toBe(0);
    // Should NOT throw "PdfjsSource already initialized"
    await source.init();
    expect(source.getPageCount()).toBe(3);
  });

  it('handles dispose during pending init (Strict Mode race)', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockDoc = (pdfjs as any)._mockDoc;

    let resolveInit!: () => void;
    vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
      promise: new Promise<any>((resolve) => {
        resolveInit = () => resolve(mockDoc);
      }),
    } as any);

    const initPromise = source.init();

    // Dispose while init is awaiting loadingTask.promise
    source.dispose();

    // First init's promise resolves after dispose — generation check should bail
    resolveInit();
    await initPromise; // should not throw, should not commit doc

    expect(source.getPageCount()).toBe(0); // doc was not committed

    // Re-init should succeed (simulates Strict Mode remount)
    await source.init();
    expect(source.getPageCount()).toBe(3);
  });
});

describe('PdfjsSource — runtime asset URL defaults', () => {
  // Inspects the existing module-level `getDocument` mock. `callCountBefore`
  // snapshots make each test independent of how many times earlier tests
  // called `getDocument` in the same file — no shared mockReset needed
  // (a reset would clobber the numPages: 3 shape the other tests depend on).

  it('passes jsDelivr CDN URL defaults pinned to pdfjs.version when no overrides are provided', async () => {
    const pdfjs = await import('pdfjs-dist');
    const getDocumentMock = vi.mocked(pdfjs.getDocument);
    const callCountBefore = getDocumentMock.mock.calls.length;

    const src = new PdfjsSource('https://example.com/doc.pdf');
    await src.init();

    expect(getDocumentMock.mock.calls.length).toBe(callCountBefore + 1);
    const opts = getDocumentMock.mock.calls[callCountBefore][0] as any;
    // Defaults follow the shape `https://cdn.jsdelivr.net/npm/pdfjs-dist@<version>/<subdir>/`.
    const base = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjs as any).version}`;
    expect(opts.wasmUrl).toBe(`${base}/wasm/`);
    expect(opts.standardFontDataUrl).toBe(`${base}/standard_fonts/`);
    expect(opts.cMapUrl).toBe(`${base}/cmaps/`);
    expect(opts.cMapPacked).toBe(true);
    expect(opts.iccUrl).toBe(`${base}/iccs/`);
  });

  it('honors consumer-provided overrides for each asset URL', async () => {
    const pdfjs = await import('pdfjs-dist');
    const getDocumentMock = vi.mocked(pdfjs.getDocument);
    const callCountBefore = getDocumentMock.mock.calls.length;

    const src = new PdfjsSource('https://example.com/doc.pdf', {
      wasmUrl: 'https://cdn.example.com/pdfjs/wasm/',
      standardFontDataUrl: 'https://cdn.example.com/pdfjs/fonts/',
      cMapUrl: 'https://cdn.example.com/pdfjs/cmaps/',
      cMapPacked: false,
      iccUrl: 'https://cdn.example.com/pdfjs/iccs/',
    });
    await src.init();

    const opts = getDocumentMock.mock.calls[callCountBefore][0] as any;
    expect(opts.wasmUrl).toBe('https://cdn.example.com/pdfjs/wasm/');
    expect(opts.standardFontDataUrl).toBe('https://cdn.example.com/pdfjs/fonts/');
    expect(opts.cMapUrl).toBe('https://cdn.example.com/pdfjs/cmaps/');
    expect(opts.cMapPacked).toBe(false);
    expect(opts.iccUrl).toBe('https://cdn.example.com/pdfjs/iccs/');
  });
});

describe('PdfjsSource — getLinks', () => {
  // Mock-ordering gotcha: PdfjsSource.init() calls page.getViewport({scale: 1.0})
  // once per page (numPages: 3) while caching page sizes. Tests that override
  // getViewport must set the override AFTER initSource(), right before
  // getLinks(0). Tests that only override getAnnotations / getDestination /
  // getPageIndex are fine as-is (init doesn't call any of them).

  // Cross-test mock isolation: some tests (g's abort, l's early return) don't
  // consume their queued mockResolvedValueOnce/mockReturnValueOnce values —
  // those would otherwise leak into the next test's getAnnotations call.
  // Reset the queue AND restore factory defaults before every test in this
  // block. Standard vitest pattern; doesn't touch getDocument/getPage/etc.
  // needed by init().
  beforeEach(async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const mockDoc = (pdfjs as any)._mockDoc;
    mockPage.getAnnotations.mockReset();
    mockPage.getAnnotations.mockImplementation(() => Promise.resolve([]));
    mockPage.getViewport.mockReset();
    mockPage.getViewport.mockImplementation(({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
      convertToViewportRectangle: vi.fn((rect: number[]) => rect),
    }));
    mockDoc.getDestination.mockReset();
    mockDoc.getPageIndex.mockReset();
  });

  async function initSource(options?: any) {
    const src = new PdfjsSource('https://example.com/doc.pdf', options);
    await src.init();
    return src;
  }

  it('(a) returns external URL link with rect from convertToViewportRectangle', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const src = await initSource();
    // Set the getViewport override AFTER init so it's consumed by
    // getLinks(0), not by the init loop.
    mockPage.getViewport.mockReturnValueOnce({
      width: 612, height: 792,
      convertToViewportRectangle: () => [100, 640, 200, 690],
    });
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Link', rect: [100, 100, 200, 150], url: 'https://example.com' },
    ]);
    const links = await src.getLinks(0);
    expect(links).toEqual([
      { rect: [100, 640, 200, 690], url: 'https://example.com' },
    ]);
  });

  it('(b) resolves explicit-dest internal link via getPageIndex only', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const mockDoc = (pdfjs as any)._mockDoc;
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Link', rect: [0, 0, 10, 10], dest: [{ num: 5 }, { name: 'XYZ' }] },
    ]);
    mockDoc.getPageIndex.mockResolvedValueOnce(3);
    const src = await initSource();
    const links = await src.getLinks(0);
    expect(mockDoc.getDestination).not.toHaveBeenCalled();
    expect(links[0].destPage).toBe(3);
  });

  it('(c) resolves named-dest via getDestination then getPageIndex', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const mockDoc = (pdfjs as any)._mockDoc;
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Link', rect: [0, 0, 10, 10], dest: 'chapter-3' },
    ]);
    mockDoc.getDestination.mockResolvedValueOnce([{ num: 7 }, { name: 'XYZ' }]);
    mockDoc.getPageIndex.mockResolvedValueOnce(5);
    const src = await initSource();
    const links = await src.getLinks(0);
    expect(mockDoc.getDestination).toHaveBeenCalledWith('chapter-3');
    expect(links[0].destPage).toBe(5);
  });

  it('(d) normalizes rects returned in flipped order (Rotate 180 style)', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const src = await initSource();
    // Simulate Rotate 180: convertToViewportRectangle returns [x2, y2, x1, y1].
    mockPage.getViewport.mockReturnValueOnce({
      width: 612, height: 792,
      convertToViewportRectangle: () => [200, 200, 100, 100],
    });
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Link', rect: [0, 0, 0, 0], url: 'https://example.com' },
    ]);
    const links = await src.getLinks(0);
    expect(links[0].rect).toEqual([100, 100, 200, 200]);
  });

  it('(e) trims whitespace before the URL scheme check', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Link', rect: [0, 0, 10, 10], url: '  https://example.com  ' },
    ]);
    const src = await initSource();
    const links = await src.getLinks(0);
    expect(links[0].url).toBe('https://example.com');
  });

  it('(f) drops pdfjs-shape action payloads and disallowed URL schemes', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const mockDoc = (pdfjs as any)._mockDoc;
    // Shapes verified against pdf.mjs:17595-17625. Real pdfjs surfaces
    // these payload fields directly on the annotation object.
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Widget', rect: [0, 0, 10, 10] },
      // JS action bundle: any triggered JS drops the link.
      { subtype: 'Link', rect: [0, 0, 10, 10],
        actions: { Action: 'app.alert("hi")' } },
      // Named action (viewer command): string, not object.
      { subtype: 'Link', rect: [0, 0, 10, 10], action: 'NextPage' },
      { subtype: 'Link', rect: [0, 0, 10, 10], action: 'Print' },
      // Object-shaped action alongside a safe URL — MUST drop. Even if the
      // URL would pass the scheme check on its own, the presence of any
      // non-null action payload is a hard reject (shape-agnostic boundary).
      { subtype: 'Link', rect: [0, 0, 10, 10],
        action: { type: 'Launch' }, url: 'https://safe.example.com' },
      // FileAttachment: drop.
      { subtype: 'Link', rect: [0, 0, 10, 10],
        attachment: { filename: 'x.pdf', content: new Uint8Array() } },
      // OCG state change: drop.
      { subtype: 'Link', rect: [0, 0, 10, 10],
        setOCGState: { state: ['ON', 'X'] } },
      // Form reset: drop.
      { subtype: 'Link', rect: [0, 0, 10, 10], resetForm: { fields: ['x'] } },
      // Disallowed URL schemes (URL surfaced but no action payload):
      { subtype: 'Link', rect: [0, 0, 10, 10], url: 'javascript:void(0)' },
      { subtype: 'Link', rect: [0, 0, 10, 10], url: 'data:text/html,x' },
      { subtype: 'Link', rect: [0, 0, 10, 10], url: 'vbscript:msgbox' },
      { subtype: 'Link', rect: [0, 0, 10, 10], url: 'file:///etc/passwd' },
      // Unresolvable named dest.
      { subtype: 'Link', rect: [0, 0, 10, 10], dest: 'unknown-bookmark' },
    ]);
    mockDoc.getDestination.mockRejectedValueOnce(new Error('unknown dest'));
    const src = await initSource();
    const links = await src.getLinks(0);
    expect(links).toEqual([]);
  });

  it('(g) rejects with AbortError when signal fires', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    // Slow annotation fetch so the abort lands during the await.
    mockPage.getAnnotations.mockReturnValueOnce(
      new Promise((resolve) => setTimeout(() => resolve([]), 50)),
    );
    const src = await initSource();
    const controller = new AbortController();
    const promise = src.getLinks(0, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
  });

  it('(h) drops annotations with non-finite rects and zero-area rects', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const src = await initSource();
    // Discriminate by input rect — annotation A → non-finite; annotation
    // B → zero-area. Both paths exercised in one getLinks call.
    mockPage.getViewport.mockReturnValueOnce({
      width: 612, height: 792,
      convertToViewportRectangle: (r: number[]) =>
        r[0] === 1 ? [NaN, 0, 10, 10] : [5, 5, 5, 5],
    });
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Link', rect: [1, 1, 2, 2], url: 'https://a.example' },
      { subtype: 'Link', rect: [3, 3, 4, 4], url: 'https://b.example' },
    ]);
    const links = await src.getLinks(0);
    expect(links).toEqual([]);
  });

  it('(i) caps output at MAX_LINKS_PER_PAGE', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const anns = Array.from({ length: 1500 }, (_, i) => ({
      subtype: 'Link', rect: [0, 0, 10, 10], url: `https://example.com/${i}`,
    }));
    mockPage.getAnnotations.mockResolvedValueOnce(anns);
    const src = await initSource();
    const links = await src.getLinks(0);
    expect(links.length).toBe(1000);
  });

  it('(j) accepts additional URL schemes; rejects regex metachars and forbidden schemes', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Link', rect: [0, 0, 10, 10], url: 'intranet://foo' },
      { subtype: 'Link', rect: [0, 0, 10, 10], url: 'javascript:alert(1)' },
    ]);
    const src = await initSource({
      additionalLinkSchemes: [
        'intranet',    // accepted: matches SCHEME_CHARS
        'javascript',  // ignored: in FORBIDDEN_SCHEMES
        'java.*',      // ignored: contains '*' (regex metachar) → fails SCHEME_CHARS
        'JavaScript',  // ignored: lower-case → 'javascript' → FORBIDDEN
      ],
    });
    const links = await src.getLinks(0);
    expect(links.map((l: any) => l.url)).toEqual(['intranet://foo']);
  });

  it('(j2) drops links whose getPageIndex returns NaN, Infinity, or negative values', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const mockDoc = (pdfjs as any)._mockDoc;
    const src = await initSource();
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Link', rect: [0, 0, 10, 10], dest: [{ num: 1 }] },
      { subtype: 'Link', rect: [0, 0, 10, 10], dest: [{ num: 2 }] },
      { subtype: 'Link', rect: [0, 0, 10, 10], dest: [{ num: 3 }] },
    ]);
    // Three link → three getPageIndex calls in Promise.all order.
    mockDoc.getPageIndex
      .mockResolvedValueOnce(NaN)
      .mockResolvedValueOnce(Infinity)
      .mockResolvedValueOnce(-1);

    const links = await src.getLinks(0);
    expect(links).toEqual([]);
  });

  it('(k) returns [] for pageIndex out of bounds without calling getPage', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockDoc = (pdfjs as any)._mockDoc;
    const src = await initSource();  // mock numPages: 3 → pageSizes.length: 3

    // Snapshot the getPage call count from init (3 calls); further calls
    // must NOT happen for out-of-bounds indices.
    const callsBefore = mockDoc.getPage.mock.calls.length;

    const negative = await src.getLinks(-1);
    const past = await src.getLinks(3);
    const wayPast = await src.getLinks(99);

    expect(negative).toEqual([]);
    expect(past).toEqual([]);
    expect(wayPast).toEqual([]);
    expect(mockDoc.getPage.mock.calls.length).toBe(callsBefore);  // no new getPage calls
  });

  it('(l) returns [] with distinctive dev warn when viewport lacks convertToViewportRectangle', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const src = await initSource();
    // Override AFTER init: return a viewport MISSING convertToViewportRectangle.
    // Simulates a pdfjs peer-dep version older than v5.0.
    mockPage.getViewport.mockReturnValueOnce({
      width: 612, height: 792,
      // convertToViewportRectangle intentionally omitted
    });
    mockPage.getAnnotations.mockResolvedValueOnce([
      { subtype: 'Link', rect: [0, 0, 10, 10], url: 'https://example.com' },
    ]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const links = await src.getLinks(0);

    expect(links).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('pdfjs viewport is missing convertToViewportRectangle'),
    );
    warnSpy.mockRestore();
  });

  it('(m) returns [] with dev warn when getAnnotations throws', async () => {
    const pdfjs = await import('pdfjs-dist');
    const mockPage = (pdfjs as any)._mockPage;
    const src = await initSource();
    mockPage.getAnnotations.mockRejectedValueOnce(new Error('worker faulted'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const links = await src.getLinks(0);

    expect(links).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('getAnnotations() failed for page 0'),
    );
    warnSpy.mockRestore();
  });
});
