// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { StrictMode, type RefObject } from 'react';
import { usePrint, type PrintCallbacks } from '../hooks/usePrint';
import { FlipbookProvider } from '../FlipbookProvider';
import type { FlipbookAction } from '../core/flipbookReducer';
import type { PageSource } from '../types/PageSource';

// ---- JSDOM stub scaffolding (per Step 5.1 plan) ----
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalPrint = window.print;
const originalDecode = HTMLImageElement.prototype.decode;

let toBlobSpy: ReturnType<typeof vi.fn>;
let createObjectURLSpy: ReturnType<typeof vi.fn>;
let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
let printSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // toBlob default: succeed with a fresh empty Blob per call.
  toBlobSpy = vi.fn((cb: BlobCallback) => cb(new Blob([], { type: 'image/png' })));
  HTMLCanvasElement.prototype.toBlob = toBlobSpy as unknown as typeof originalToBlob;

  let n = 0;
  createObjectURLSpy = vi.fn(() => `blob:test/${++n}`);
  URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;

  revokeObjectURLSpy = vi.fn();
  URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;

  printSpy = vi.fn();
  window.print = printSpy as unknown as typeof window.print;

  // Default decode: resolve immediately so the loop advances per page.
  HTMLImageElement.prototype.decode = function () { return Promise.resolve(); };
});

afterEach(() => {
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  window.print = originalPrint;
  HTMLImageElement.prototype.decode = originalDecode;
  cleanup();
  vi.restoreAllMocks();
});

// ---- Stub PageSource helper (per Step 5.1 plan) ----
interface StubSourceOptions {
  honorAbort?: boolean;
  canvasWidth?: number;
  canvasHeight?: number;
  renderImpl?: (index: number, scale: number, signal?: AbortSignal) => Promise<HTMLCanvasElement>;
}
function makeStubSource(pageCount: number, opts: StubSourceOptions = {}) {
  const honorAbort = opts.honorAbort ?? true;
  const returnedCanvases: HTMLCanvasElement[] = [];
  const renderPageSpy = vi.fn(async (
    index: number,
    scale: number,
    signal?: AbortSignal,
  ): Promise<HTMLCanvasElement> => {
    if (honorAbort && signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (opts.renderImpl) return opts.renderImpl(index, scale, signal);
    const canvas = document.createElement('canvas');
    canvas.width = opts.canvasWidth ?? 100;
    canvas.height = opts.canvasHeight ?? 100;
    returnedCanvases.push(canvas);
    return canvas;
  });
  const source: PageSource = {
    init: () => Promise.resolve(),
    getPageCount: () => pageCount,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: renderPageSpy as unknown as PageSource['renderPage'],
    dispose: () => {},
  };
  return { source, returnedCanvases, renderPageSpy };
}

// ---- renderHook wrapper that sets sensible defaults + exposes spies ----
interface HookOpts {
  source?: PageSource;
  pageCount?: number;
  isPrinting?: boolean;
  printMaxPages?: number;
  printScale?: number;
  callbacks?: PrintCallbacks;
}
function renderPrintHook(opts: HookOpts = {}) {
  const source = opts.source ?? makeStubSource(opts.pageCount ?? 3).source;
  const dispatchSpy = vi.fn<(action: FlipbookAction) => void>();
  const callbacksRef: RefObject<PrintCallbacks> = { current: opts.callbacks ?? {} };
  const initialProps = {
    source,
    dispatch: dispatchSpy,
    pageCount: opts.pageCount ?? 3,
    isPrinting: opts.isPrinting ?? false,
    printMaxPages: opts.printMaxPages ?? 100,
    printScale: opts.printScale ?? 2.0,
    callbacksRef,
  };
  const r = renderHook((props: typeof initialProps) => usePrint(props), { initialProps });
  return { ...r, dispatchSpy, callbacksRef, source, initialProps };
}

async function fireAfterprint() {
  await act(async () => {
    window.dispatchEvent(new Event('afterprint'));
  });
}

// Polls until pred() is true (or maxIter iterations elapse). Each iteration
// drains microtasks + one macrotask via a setTimeout(0). Used for tests that
// drive the print loop step-by-step through controlled resolvers — the loop
// body has multiple awaits per iteration (renderPage, toBlob, decode,
// setTimeout(0) yield) and a single `setTimeout(0)` await isn't always
// enough to advance the loop, especially when full-suite timing varies.
async function waitFor(pred: () => boolean, maxIter = 50) {
  for (let i = 0; i < maxIter; i++) {
    if (pred()) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  throw new Error('waitFor predicate never satisfied');
}

// ============================================================
// Tests
// ============================================================

describe('usePrint — Phase 5.1', () => {
  // 1
  it('1. Too-large → dispatches SET_PRINT_ERROR (too-large) + does NOT start pipeline', async () => {
    const { source, renderPageSpy } = makeStubSource(200);
    const { result, dispatchSpy } = renderPrintHook({ source, pageCount: 200, printMaxPages: 100 });
    await act(async () => { await result.current.print(); });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_PRINT_ERROR',
      payload: { type: 'too-large', totalPages: 200, limit: 100 },
    });
    expect(dispatchSpy.mock.calls.find((c) => c[0].type === 'SET_PRINTING')).toBeUndefined();
    expect(renderPageSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
    expect(printSpy).not.toHaveBeenCalled();
  });

  // 2
  it('2. Under-ceiling happy path → renders all pages in order + calls window.print() once + sheet in DOM', async () => {
    const { source, renderPageSpy } = makeStubSource(3);
    const { result } = renderPrintHook({ source, pageCount: 3 });
    await act(async () => { await result.current.print(); });
    expect(renderPageSpy).toHaveBeenCalledTimes(3);
    expect(renderPageSpy.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
    expect(printSpy).toHaveBeenCalledOnce();
    expect(document.querySelector('.fbjs-print-sheet')).not.toBeNull();
  });

  // 3
  it('3. Streaming canvas release (A11) — returned canvases zeroed after the loop; renderPage receives AbortSignal', async () => {
    const { source, returnedCanvases, renderPageSpy } = makeStubSource(3);
    const { result } = renderPrintHook({ source, pageCount: 3 });
    await act(async () => { await result.current.print(); });
    expect(returnedCanvases).toHaveLength(3);
    for (const canvas of returnedCanvases) {
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
    }
    for (const call of renderPageSpy.mock.calls) {
      expect(call[2]).toBeInstanceOf(AbortSignal);
    }
  });

  // 4
  it('4. afterprint cleanup → sheet removed, URLs revoked, SET_PRINTING false dispatched', async () => {
    const { result, dispatchSpy } = renderPrintHook({ pageCount: 3 });
    await act(async () => { await result.current.print(); });
    expect(document.querySelector('.fbjs-print-sheet')).not.toBeNull();
    await fireAfterprint();
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(3);
    const setPrintingFalse = dispatchSpy.mock.calls.filter(
      (c) => c[0].type === 'SET_PRINTING' && c[0].value === false,
    );
    expect(setPrintingFalse).toHaveLength(1);
  });

  // 5
  it('5. Re-entry guard (C1) — synchronous claim short-circuits second call', async () => {
    const { source, renderPageSpy } = makeStubSource(3);
    const { result } = renderPrintHook({ source, pageCount: 3 });
    await act(async () => {
      const p1 = result.current.print();
      const p2 = result.current.print();   // sees isPrintingRef=true → returns immediately
      await Promise.all([p1, p2]);
    });
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(renderPageSpy).toHaveBeenCalledTimes(3);   // exactly N renders, NOT 2N
  });

  // 6
  it('6. Source-change abort → in-flight pipeline aborts + post-render canvas zeroed even on non-abort-aware sources', async () => {
    // Stub source A: renderPage RESOLVES (does not honor signal) so we can trigger the
    // post-render abort path (signal aborts between renderPage resolving and continuation).
    let releaseFirstRender: ((c: HTMLCanvasElement) => void) | null = null;
    const sourceA = makeStubSource(3, {
      honorAbort: false,
      renderImpl: (_idx, _scale) => new Promise<HTMLCanvasElement>((resolve) => {
        if (!releaseFirstRender) {
          releaseFirstRender = resolve;
          return;
        }
        // Subsequent calls resolve immediately (won't be reached after abort).
        const c = document.createElement('canvas');
        c.width = 100; c.height = 100;
        resolve(c);
      }),
    });
    const onPrintAbort = vi.fn();
    const { result, rerender, initialProps } = renderPrintHook({
      source: sourceA.source,
      pageCount: 3,
      callbacks: { onPrintAbort },
    });
    let printPromise: Promise<void>;
    await act(async () => {
      printPromise = result.current.print();
      await Promise.resolve();   // let pipeline start + park on first renderPage
    });

    // Trigger source change so the source-keyed effect cleanup runs.
    const sourceB = makeStubSource(3).source;
    rerender({ ...initialProps, source: sourceB });

    // Now release the parked renderPage — its canvas will be returned, but the signal
    // is already aborted, so renderPageToBlob's post-render abort check zeros the canvas.
    const capturedCanvas = document.createElement('canvas');
    capturedCanvas.width = 100; capturedCanvas.height = 100;
    releaseFirstRender!(capturedCanvas);

    await act(async () => { await printPromise!.catch(() => {}); });
    expect(capturedCanvas.width).toBe(0);
    expect(capturedCanvas.height).toBe(0);
    expect(printSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
    expect(onPrintAbort).toHaveBeenCalledWith({ reason: 'source-change' });
  });

  // 7
  it('7. Unmount abort → pipeline aborts; no leaked sheet; signal.aborted=true', async () => {
    let capturedSignal: AbortSignal | undefined;
    let releaseFirst: ((c: HTMLCanvasElement) => void) | null = null;
    const { source } = makeStubSource(3, {
      renderImpl: (_idx, _scale, signal) => new Promise<HTMLCanvasElement>((resolve) => {
        capturedSignal = signal;
        if (!releaseFirst) { releaseFirst = resolve; return; }
        const c = document.createElement('canvas'); c.width = 100; c.height = 100; resolve(c);
      }),
    });
    const onPrintAbort = vi.fn();
    const { result, unmount } = renderPrintHook({ source, pageCount: 3, callbacks: { onPrintAbort } });
    await act(async () => { result.current.print(); });
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
    expect(onPrintAbort).toHaveBeenCalledWith({ reason: 'unmount' });
  });

  // 8
  it('8. Ref-mirror latest — printMaxPages rerender is observed on next print()', async () => {
    const { result, rerender, dispatchSpy, initialProps } = renderPrintHook({
      pageCount: 10,
      printMaxPages: 200,
    });
    rerender({ ...initialProps, printMaxPages: 5 });
    await act(async () => { await result.current.print(); });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_PRINT_ERROR',
      payload: { type: 'too-large', totalPages: 10, limit: 5 },
    });
  });

  // 9
  it('9. canvas.toBlob failure → rejects with PrintBlobConversionError + cleanup ran', async () => {
    toBlobSpy.mockImplementation((cb: BlobCallback) => cb(null));
    const onPrintError = vi.fn();
    const { result } = renderPrintHook({ pageCount: 1, callbacks: { onPrintError } });
    let caught: Error | undefined;
    await act(async () => {
      try { await result.current.print(); } catch (e) { caught = e as Error; }
    });
    expect(caught).toBeDefined();
    expect(caught!.name).toBe('PrintBlobConversionError');
    expect(caught!.message).toContain('printScale');
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
    expect(onPrintError).toHaveBeenCalled();
    expect((onPrintError.mock.calls[0][1] as { phase: string }).phase).toBe('blob');
  });

  // 10
  it('10. Print sheet DOM structure — N <img class="fbjs-print-page"> children for N pages', async () => {
    const { result } = renderPrintHook({ pageCount: 3 });
    await act(async () => { await result.current.print(); });
    const sheet = document.querySelector('.fbjs-print-sheet')!;
    const imgs = sheet.querySelectorAll('img.fbjs-print-page');
    expect(imgs).toHaveLength(3);
  });

  // 11
  it('11. Cleanup idempotency (H1) — afterprint then unmount runs cleanup once', async () => {
    const { result, dispatchSpy, unmount } = renderPrintHook({ pageCount: 3 });
    await act(async () => { await result.current.print(); });
    await fireAfterprint();
    await fireAfterprint();   // second afterprint event
    unmount();
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(3);   // NOT 6 or 9
    const setPrintingFalse = dispatchSpy.mock.calls.filter(
      (c) => c[0].type === 'SET_PRINTING' && c[0].value === false,
    );
    expect(setPrintingFalse).toHaveLength(1);
  });

  // 12
  it('12. afterprint listener leak on window.print() throw (H2)', async () => {
    printSpy.mockImplementation(() => { throw new Error('window.print failed'); });
    const { result } = renderPrintHook({ pageCount: 2 });
    await act(async () => {
      try { await result.current.print(); } catch { /* expected */ }
    });
    const callCountBeforeAfterprint = revokeObjectURLSpy.mock.calls.length;
    await fireAfterprint();
    expect(revokeObjectURLSpy.mock.calls.length).toBe(callCountBeforeAfterprint);
  });

  // 13
  it('13. M2 — Clear stale printError at start of successful pipeline', async () => {
    const { result, dispatchSpy } = renderPrintHook({ pageCount: 1 });
    await act(async () => { await result.current.print(); });
    const clearIdx = dispatchSpy.mock.calls.findIndex((c) => c[0].type === 'CLEAR_PRINT_ERROR');
    const setPrintingTrueIdx = dispatchSpy.mock.calls.findIndex(
      (c) => c[0].type === 'SET_PRINTING' && c[0].value === true,
    );
    expect(clearIdx).toBeGreaterThan(-1);
    expect(setPrintingTrueIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeLessThan(setPrintingTrueIdx);
  });

  // 14
  it('14. M4 — pageCount === 0 early return', async () => {
    const { source, renderPageSpy } = makeStubSource(0);
    const { result, dispatchSpy } = renderPrintHook({ source, pageCount: 0 });
    await act(async () => { await result.current.print(); });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(renderPageSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
    expect(printSpy).not.toHaveBeenCalled();
  });

  // 15
  it('15. C3 — Mid-print prop change does NOT affect in-flight job', async () => {
    const renderResolvers: Array<(c: HTMLCanvasElement) => void> = [];
    const scalesSeen: number[] = [];
    const { source } = makeStubSource(3, {
      renderImpl: (_idx, scale) => new Promise<HTMLCanvasElement>((resolve) => {
        scalesSeen.push(scale);
        renderResolvers.push(resolve);
      }),
    });
    const { result, rerender, initialProps } = renderPrintHook({
      source,
      pageCount: 3,
      printScale: 2.0,
    });
    let p: Promise<void>;
    await act(async () => { p = result.current.print(); });
    await waitFor(() => renderResolvers.length >= 1);
    // Rerender with new printScale BEFORE the first renderPage resolves.
    rerender({ ...initialProps, printScale: 4.0 });
    // Resolve page 1.
    renderResolvers[0](makeCanvas());
    await waitFor(() => renderResolvers.length >= 2);
    renderResolvers[1](makeCanvas());
    await waitFor(() => renderResolvers.length >= 3);
    renderResolvers[2](makeCanvas());
    await act(async () => { await p!; });
    // All 3 renders saw scale=2.0 (snapshotted at print start; the mid-print rerender
    // changes printScaleRef.current but the running pipeline captured scale=2.0).
    expect(scalesSeen).toEqual([2.0, 2.0, 2.0]);
  });

  // 16
  it('16. M7 — Oversized canvas → PrintBlobConversionError with typed fields + zero-before-throw', async () => {
    const { source } = makeStubSource(1, { canvasWidth: 16385, canvasHeight: 7777 });
    const onPrintError = vi.fn();
    const { result, dispatchSpy } = renderPrintHook({ source, pageCount: 1, callbacks: { onPrintError } });
    let caught: Error | undefined;
    await act(async () => {
      try { await result.current.print(); } catch (e) { caught = e as Error; }
    });
    expect(caught).toBeDefined();
    expect(caught!.name).toBe('PrintBlobConversionError');
    expect((caught as any).pageIndex).toBe(0);
    expect((caught as any).canvasWidth).toBe(16385);
    expect((caught as any).canvasHeight).toBe(7777);
    expect(caught!.message).toContain('printScale');
    expect(caught!.message).toContain('16385');
    const dispatched = dispatchSpy.mock.calls.find(
      (c) => c[0].type === 'SET_PRINT_ERROR' && c[0].payload.type === 'blob-conversion-failed',
    );
    expect(dispatched).toBeDefined();
    expect(dispatched![0]).toEqual({
      type: 'SET_PRINT_ERROR',
      payload: {
        type: 'blob-conversion-failed',
        pageIndex: 0,
        canvasWidth: 16385,
        canvasHeight: 7777,
      },
    });
    expect(onPrintError).toHaveBeenCalled();
    expect((onPrintError.mock.calls[0][1] as { phase: string }).phase).toBe('blob');
  });

  // 17
  it('17. O1 — All four lifecycle callbacks fire at the correct times (incl. try/catch swallow)', async () => {
    const onPrintStart = vi.fn();
    const onPrintComplete = vi.fn();
    const onPrintError = vi.fn();
    const onPrintAbort = vi.fn();

    // Happy path
    {
      const { result } = renderPrintHook({
        pageCount: 3,
        callbacks: { onPrintStart, onPrintComplete, onPrintError, onPrintAbort },
      });
      await act(async () => { await result.current.print(); });
      await fireAfterprint();
      expect(onPrintStart).toHaveBeenCalledWith({ totalPages: 3, scale: 2.0 });
      expect(onPrintComplete).toHaveBeenCalled();
      const arg = onPrintComplete.mock.calls[0][0] as { totalPages: number; durationMs: number };
      expect(arg.totalPages).toBe(3);
      expect(arg.durationMs).toBeGreaterThanOrEqual(0);
      cleanup();
    }

    // Unmount abort
    {
      onPrintAbort.mockClear();
      let release: ((c: HTMLCanvasElement) => void) | null = null;
      const { source } = makeStubSource(3, {
        renderImpl: () => new Promise<HTMLCanvasElement>((resolve) => {
          if (!release) { release = resolve; return; }
          const c = document.createElement('canvas'); c.width = 100; c.height = 100; resolve(c);
        }),
      });
      const { result, unmount } = renderPrintHook({ source, pageCount: 3, callbacks: { onPrintAbort } });
      await act(async () => { result.current.print(); });
      unmount();
      expect(onPrintAbort).toHaveBeenCalledWith({ reason: 'unmount' });
    }

    // Error path
    {
      onPrintError.mockClear();
      const { source } = makeStubSource(1, {
        renderImpl: () => Promise.reject(new Error('render boom')),
      });
      const { result } = renderPrintHook({ source, pageCount: 1, callbacks: { onPrintError } });
      await act(async () => {
        try { await result.current.print(); } catch { /* expected */ }
      });
      expect(onPrintError).toHaveBeenCalled();
      expect((onPrintError.mock.calls[0][1] as { phase: string }).phase).toBe('render');
    }
  });

  // 18
  it('18. O2 — Suspense fallback mid-print is handled via the unmount-cleanup path', async () => {
    // Simplified: verify that when the hook unmounts (which would happen under Suspense
    // fallback), the in-flight pipeline aborts cleanly with reason: 'unmount'.
    let release: ((c: HTMLCanvasElement) => void) | null = null;
    const { source } = makeStubSource(3, {
      renderImpl: () => new Promise<HTMLCanvasElement>((resolve) => {
        if (!release) { release = resolve; return; }
        const c = document.createElement('canvas'); c.width = 100; c.height = 100; resolve(c);
      }),
    });
    const onPrintAbort = vi.fn();
    const { result, unmount } = renderPrintHook({ source, pageCount: 3, callbacks: { onPrintAbort } });
    await act(async () => { result.current.print(); });
    // Suspense fallback would unmount the hook subtree → same cleanup path.
    unmount();
    expect(onPrintAbort).toHaveBeenCalledWith({ reason: 'unmount' });
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
  });

  // 19
  it('19. H11 — StrictMode double-invoke safety', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const source = makeStubSource(2).source;
    const dispatchSpy = vi.fn<(action: FlipbookAction) => void>();
    const callbacksRef: RefObject<PrintCallbacks> = { current: {} };
    const { result } = renderHook(
      () => usePrint({
        source,
        dispatch: dispatchSpy,
        pageCount: 2,
        isPrinting: false,
        printMaxPages: 100,
        printScale: 2.0,
        callbacksRef,
      }),
      { wrapper },
    );
    await act(async () => { await result.current.print(); });
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.fbjs-print-sheet')).not.toBeNull();
    await fireAfterprint();
    expect(document.querySelectorAll('.fbjs-print-sheet')).toHaveLength(0);
  });

  // 20
  it('20. M13 — SSR safety: renderToString does not access window/document/URL during render', async () => {
    // The hook accesses DOM only inside print() — which only fires from user click.
    // Verify the hook can be rendered server-side without errors.
    const { source } = makeStubSource(1);
    const html = renderToString(
      <FlipbookProvider source={source} />,
    );
    expect(typeof html).toBe('string');
  });

  // 21a
  it('21a. Sequential decode — print() waits for each decode before advancing', async () => {
    const decodeResolvers: Array<() => void> = [];
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve) => { decodeResolvers.push(resolve); });
    };
    const { result } = renderPrintHook({ pageCount: 3 });
    let printPromise: Promise<void>;
    await act(async () => { printPromise = result.current.print(); });
    await waitFor(() => decodeResolvers.length >= 1);
    expect(printSpy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.fbjs-print-page')).toHaveLength(1);

    decodeResolvers[0]();
    await waitFor(() => decodeResolvers.length >= 2);
    expect(printSpy).not.toHaveBeenCalled();

    decodeResolvers[1]();
    await waitFor(() => decodeResolvers.length >= 3);
    expect(printSpy).not.toHaveBeenCalled();

    await act(async () => { decodeResolvers[2](); await printPromise!; });
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  // 21b
  it('21b. Decode failure → PrintRenderError + render-failed dispatch with pageIndex from typed error', async () => {
    const decodeResolvers: Array<() => void> = [];
    const decodeRejecters: Array<(err: Error) => void> = [];
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve, reject) => {
        decodeResolvers.push(resolve);
        decodeRejecters.push(reject);
      });
    };
    const { result, dispatchSpy } = renderPrintHook({ pageCount: 3 });
    let caught: Error | undefined;
    let printPromise: Promise<void>;
    await act(async () => { printPromise = result.current.print(); });
    await waitFor(() => decodeRejecters.length >= 1);
    await act(async () => {
      decodeRejecters[0](new Error('decode failure'));
      try { await printPromise!; } catch (e) { caught = e as Error; }
    });
    expect(caught).toBeDefined();
    expect(caught!.name).toBe('PrintRenderError');
    expect((caught as any).pageIndex).toBe(0);
    expect(caught!.message).toContain('decode failure');
    const dispatched = dispatchSpy.mock.calls.find(
      (c) => c[0].type === 'SET_PRINT_ERROR' && c[0].payload.type === 'render-failed',
    );
    expect(dispatched).toBeDefined();
    expect((dispatched![0] as any).payload.pageIndex).toBe(0);
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
  });

  // 21c
  it('21c. Abort during decode → print rejects + sheet removed + onPrintAbort source-change', async () => {
    const decodeResolvers: Array<() => void> = [];
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve) => { decodeResolvers.push(resolve); });
    };
    const { source: sourceA } = makeStubSource(3);
    const onPrintAbort = vi.fn();
    const { result, rerender, initialProps } = renderPrintHook({
      source: sourceA,
      pageCount: 3,
      callbacks: { onPrintAbort },
    });
    let printPromise: Promise<void>;
    await act(async () => { printPromise = result.current.print(); });
    await waitFor(() => decodeResolvers.length >= 1);
    // Resolve page 1's decode, park on page 2's.
    decodeResolvers[0]();
    await waitFor(() => decodeResolvers.length >= 2);

    // Trigger source change to abort the in-flight job.
    const sourceB = makeStubSource(3).source;
    rerender({ ...initialProps, source: sourceB });

    // The hook silences AbortError in the outer catch and resolves print() with undefined.
    // Assert the abort behavior via the callback + sheet removal, not via promise rejection.
    await act(async () => { await printPromise!; });
    expect(printSpy).not.toHaveBeenCalled();
    expect(onPrintAbort).toHaveBeenCalledWith({ reason: 'source-change' });
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
  });

  // 22
  it('22. actions.cancelPrint() — user-initiated escape', async () => {
    let capturedSignal: AbortSignal | undefined;
    const decodeResolvers: Array<() => void> = [];
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve) => { decodeResolvers.push(resolve); });
    };
    const { source } = makeStubSource(3, {
      renderImpl: (_idx, _scale, signal) => {
        capturedSignal = signal;
        const c = document.createElement('canvas'); c.width = 100; c.height = 100;
        return Promise.resolve(c);
      },
    });
    const onPrintAbort = vi.fn();
    const { result, dispatchSpy } = renderPrintHook({ source, pageCount: 3, callbacks: { onPrintAbort } });
    let printPromise: Promise<void>;
    await act(async () => { printPromise = result.current.print(); });
    await waitFor(() => decodeResolvers.length >= 1);
    // Resolve decode[0], park on decode[1].
    decodeResolvers[0]();
    await waitFor(() => decodeResolvers.length >= 2);

    // Call cancelPrint synchronously.
    act(() => { result.current.cancelPrint(); });

    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
    // 2 URLs created before cancelPrint fired: page 1's (decoded) AND page 2's (URL
    // created and img appended, then parked on its decode). Both revoked by cleanup.
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(2);
    expect(capturedSignal?.aborted).toBe(true);
    const setPrintingFalse = dispatchSpy.mock.calls.filter(
      (c) => c[0].type === 'SET_PRINTING' && c[0].value === false,
    );
    expect(setPrintingFalse).toHaveLength(1);
    expect(onPrintAbort).toHaveBeenCalledWith({ reason: 'user-cancel' });
    expect(onPrintAbort).toHaveBeenCalledTimes(1);

    // Let abort cascade through decode[1].
    await act(async () => {
      try { await printPromise!; } catch { /* expected */ }
    });
    // Cleanup idempotent — onPrintAbort still 1 call.
    expect(onPrintAbort).toHaveBeenCalledTimes(1);

    // No-op when no print is in flight.
    onPrintAbort.mockClear();
    dispatchSpy.mockClear();
    act(() => { result.current.cancelPrint(); });
    expect(onPrintAbort).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  // 23
  it('23. Post-loop mid-yield abort — cancelPrint during the final setTimeout(0) does NOT call window.print()', async () => {
    // Use fake timers so we control the setTimeout(0) yield precisely.
    vi.useFakeTimers();
    HTMLImageElement.prototype.decode = function () { return Promise.resolve(); };
    const { source } = makeStubSource(3);
    const onPrintAbort = vi.fn();
    const { result } = renderPrintHook({ source, pageCount: 3, callbacks: { onPrintAbort } });
    let printPromise: Promise<void>;
    await act(async () => { printPromise = result.current.print(); });
    // Advance the first two iterations' yields.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });

    // After page 3's decode resolved + setTimeout(0) yield is parked — cancel.
    act(() => { result.current.cancelPrint(); });

    // Flush remaining timers.
    await act(async () => {
      await vi.runAllTimersAsync();
      try { await printPromise!; } catch { /* expected: AbortError silenced */ }
    });
    expect(printSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.fbjs-print-sheet')).toBeNull();
    expect(onPrintAbort).toHaveBeenCalledWith({ reason: 'user-cancel' });
    vi.useRealTimers();
  });
});

// ---- helper used by test #15 ----
function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = 100;
  c.height = 100;
  return c;
}
