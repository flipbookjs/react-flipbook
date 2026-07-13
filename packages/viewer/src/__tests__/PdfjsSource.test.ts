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
    })),
    render: vi.fn(() => mockRenderTask),
  };

  const mockDoc = {
    numPages: 3,
    getPage: vi.fn(() => Promise.resolve(mockPage)),
    destroy: vi.fn(),
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
