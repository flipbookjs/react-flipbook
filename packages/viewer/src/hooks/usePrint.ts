import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject } from 'react';
import { devWarn } from '../core/devWarn';
import type { FlipbookAction } from '../core/flipbookReducer';
import type { PageSource } from '../types/PageSource';

const MAX_CANVAS_DIM = 16384;  // M7 — Chrome ceiling; Safari is lower

// Typed error subclasses carry the phase discriminator + canvas dims as
// first-class fields, instead of encoding them as magic substrings in the
// error message. The for-loop catch reads `err.phase` directly, eliminating
// the fragile `message.includes('blob conversion')` parse and the brittle
// `/canvas size (\d+)×(\d+)/` regex that previously coupled three places to
// the exact wording of the diagnostic string.
class PrintRenderError extends Error {
  readonly phase = 'render' as const;
  constructor(message: string, public readonly pageIndex: number) {
    super(message);
    this.name = 'PrintRenderError';
  }
}
class PrintBlobConversionError extends Error {
  readonly phase = 'blob' as const;
  constructor(
    message: string,
    public readonly pageIndex: number,
    public readonly canvasWidth: number,
    public readonly canvasHeight: number,
  ) {
    super(message);
    this.name = 'PrintBlobConversionError';
  }
}

export interface PrintCallbacks {
  onPrintStart?: (info: { totalPages: number; scale: number }) => void;
  onPrintComplete?: (info: { totalPages: number; durationMs: number }) => void;
  onPrintError?: (error: Error, info: { phase: 'too-large' | 'render' | 'blob' }) => void;
  onPrintAbort?: (info: { reason: 'unmount' | 'source-change' | 'user-cancel' }) => void;
}

interface UsePrintArgs {
  source: PageSource;
  dispatch: Dispatch<FlipbookAction>;
  pageCount: number;
  isPrinting: boolean;
  printMaxPages: number;
  printScale: number;
  callbacksRef: RefObject<PrintCallbacks>;
}

interface UsePrintReturn {
  print: () => Promise<void>;
  cancelPrint: () => void;
}

// ---------- Module-private helpers ----------

function setupPrintSheet(): { printSheet: HTMLDivElement; objectUrls: string[] } {
  const printSheet = document.createElement('div');
  printSheet.className = 'fbjs-print-sheet';
  document.body.appendChild(printSheet);
  return { printSheet, objectUrls: [] };
}

type CleanupOutcome =
  | { kind: 'success' }
  | { kind: 'abort'; reason: 'unmount' | 'source-change' | 'user-cancel' }
  | { kind: 'error'; error: Error; phase: 'render' | 'blob' };

function makeCleanup(args: {
  printSheet: HTMLElement;
  objectUrls: string[];
  abortControllerRef: MutableRefObject<AbortController | null>;
  isPrintingRef: MutableRefObject<boolean>;
  // Reference back to the hook's `activeCleanupRef` so cleanup can null
  // itself when it runs (otherwise the closure retains `printSheet` and
  // `objectUrls` until the NEXT print/source-change/unmount overwrites or
  // clears the ref — a real cross-job memory leak).
  activeCleanupRef: MutableRefObject<((outcome: CleanupOutcome) => void) | null>;
  dispatch: Dispatch<FlipbookAction>;
  startTime: number;
  totalPages: number;
  callbacksRef: RefObject<PrintCallbacks>;
}): (outcome: CleanupOutcome) => void {
  let cleanedUp = false;
  const cleanup = (outcome: CleanupOutcome) => {
    if (cleanedUp) return;
    cleanedUp = true;
    // Self-remove the afterprint listener so a late-firing afterprint
    // (after we've cleaned up via abort/error) doesn't double-invoke.
    window.removeEventListener('afterprint', afterprintHandler);
    // Remove DOM before revoking URLs (img refs go away cleanly).
    args.printSheet.remove();
    args.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    args.abortControllerRef.current = null;
    args.isPrintingRef.current = false;  // synchronous release for re-entry guard
    // Null the hook's activeCleanupRef so neither this closure nor its
    // captured printSheet/objectUrls are retained past cleanup. Without this
    // line, successful prints leave activeCleanupRef pointing at a closure
    // holding DOM references until the next print job overwrites it.
    args.activeCleanupRef.current = null;
    args.dispatch({ type: 'SET_PRINTING', value: false });
    // Fire the appropriate consumer lifecycle callback. Wrapped in try/catch
    // so a throwing consumer callback doesn't break cleanup.
    try {
      if (outcome.kind === 'success') {
        args.callbacksRef.current?.onPrintComplete?.({
          totalPages: args.totalPages,
          durationMs: performance.now() - args.startTime,
        });
      } else if (outcome.kind === 'abort') {
        args.callbacksRef.current?.onPrintAbort?.({ reason: outcome.reason });
      } else {
        args.callbacksRef.current?.onPrintError?.(outcome.error, { phase: outcome.phase });
      }
    } catch (err) {
      devWarn('[flipbook] consumer print-lifecycle callback threw; ignoring', err);
    }
  };
  // afterprintHandler is what the window listener is REGISTERED with — wraps
  // cleanup() with the success outcome. Hoisted-let-then-assigned so cleanup
  // can reference its identity for removeEventListener (idempotent guard).
  let afterprintHandler: () => void;
  afterprintHandler = () => cleanup({ kind: 'success' });
  // Expose afterprintHandler via the returned function's `.afterprint` property
  // so the print loop can register it.
  (cleanup as { afterprint?: () => void }).afterprint = afterprintHandler;
  return cleanup;
}

async function renderPageToBlob(args: {
  source: PageSource;
  pageIndex: number;
  scale: number;
  signal: AbortSignal;
}): Promise<Blob> {
  const canvas = await args.source.renderPage(args.pageIndex, args.scale, args.signal);
  // If the signal aborted BETWEEN renderPage resolving and our continuation,
  // the canvas is fully allocated but we never use it — zero the backing
  // buffer NOW so it's GC-eligible immediately, otherwise the canvas sits in
  // memory until the throw bubbles all the way up and the local reference
  // goes out of scope.
  if (args.signal.aborted) {
    canvas.width = 0; canvas.height = 0;
    throw new DOMException('Print aborted', 'AbortError');
  }
  // Pre-check canvas dimensions. If oversized, snapshot dims FIRST, zero the
  // canvas to free the backing buffer immediately (this is the exact path
  // where the buffer may be huge — multi-hundred-MB), THEN throw the
  // descriptive error. Throwing before zeroing strands the buffer until GC
  // collects the canvas reference + bubbles up the stack.
  if (canvas.width > MAX_CANVAS_DIM || canvas.height > MAX_CANVAS_DIM) {
    const oversizedWidth = canvas.width;
    const oversizedHeight = canvas.height;
    canvas.width = 0; canvas.height = 0;  // free the (likely massive) backing buffer NOW
    // Oversize is structurally a blob-conversion failure (we never got far
    // enough to call toBlob — but the symptom and remediation are identical:
    // reduce printScale). Throwing PrintBlobConversionError carries the dims
    // through to the dispatched `blob-conversion-failed` payload without the
    // catch having to regex-parse the message.
    throw new PrintBlobConversionError(
      `Page ${args.pageIndex + 1} canvas (${oversizedWidth}×${oversizedHeight}) exceeds browser ` +
      `canvas limit (${MAX_CANVAS_DIM}). Reduce printScale (currently ${args.scale}).`,
      args.pageIndex, oversizedWidth, oversizedHeight,
    );
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  // Snapshot dimensions BEFORE the streaming-release zero — otherwise the
  // PrintBlobConversionError's `canvasWidth`/`canvasHeight` fields would see
  // 0×0 (the value AFTER we zero them for GC).
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  // Streaming canvas release: zero backing buffer immediately so it's
  // GC-eligible before the next iteration allocates the next page.
  canvas.width = 0; canvas.height = 0;
  if (args.signal.aborted) throw new DOMException('Print aborted', 'AbortError');
  if (!blob) {
    // Safari toBlob() returns null at sizes well below MAX_CANVAS_DIM;
    // surface the canvas size so the diagnostic message is actionable.
    throw new PrintBlobConversionError(
      `Page ${args.pageIndex + 1} blob conversion failed at canvas size ${canvasWidth}×${canvasHeight}. ` +
      `Reduce printScale (currently ${args.scale}) or printMaxPages.`,
      args.pageIndex, canvasWidth, canvasHeight,
    );
  }
  return blob;
}

// Force the browser to decode a blob-backed <img> to a paint-ready bitmap.
// Without this, window.print() may fire before all images are decoded → blank
// or partially-blank pages in the printed output.
//
// Abort-aware: the decode wait is RACED against an abort listener so a
// source-change / unmount / user-cancel can terminate the wait promptly even
// if decode would otherwise hang (e.g., a revoked blob URL stalls decode
// indefinitely on some browsers).
async function decodePrintImage(args: {
  img: HTMLImageElement;
  pageIndex: number;
  signal: AbortSignal;
}): Promise<void> {
  if (args.signal.aborted) throw new DOMException('Print aborted', 'AbortError');

  return new Promise<void>((resolve, reject) => {
    const releaseListener = () => args.signal.removeEventListener('abort', abortHandler);
    const abortHandler = () => {
      releaseListener();
      reject(new DOMException('Print aborted', 'AbortError'));
    };
    args.signal.addEventListener('abort', abortHandler);

    args.img.decode().then(
      () => { releaseListener(); resolve(); },
      (err: Error) => {
        releaseListener();
        reject(new PrintRenderError(
          `Page ${args.pageIndex + 1} image decode failed: ${err.message}`,
          args.pageIndex,
        ));
      },
    );
  });
}

// ---------- The hook ----------

export function usePrint({
  source, dispatch, pageCount, isPrinting, printMaxPages, printScale, callbacksRef,
}: UsePrintArgs): UsePrintReturn {
  const isPrintingRef = useRef(isPrinting);
  const pageCountRef = useRef(pageCount);
  const printMaxPagesRef = useRef(printMaxPages);
  const printScaleRef = useRef(printScale);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Holds the makeCleanup return value of the in-flight print job so the
  // source-change/unmount effects can call it with the right abort reason.
  const activeCleanupRef = useRef<((outcome: CleanupOutcome) => void) | null>(null);
  // sourceRef tracks the latest source value seen during render — the
  // source-change cleanup uses this to distinguish source-change (sourceRef !==
  // sourceAtMount) from unmount (sourceRef === sourceAtMount).
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => { isPrintingRef.current = isPrinting; }, [isPrinting]);
  useEffect(() => { pageCountRef.current = pageCount; }, [pageCount]);
  useEffect(() => { printMaxPagesRef.current = printMaxPages; }, [printMaxPages]);
  useEffect(() => { printScaleRef.current = printScale; }, [printScale]);

  // Source-keyed abort cleanup. Fires on (a) source-change rerender, (b) unmount.
  // Uses the sourceRef trick to distinguish: on source change, sourceRef.current
  // has the NEW source while sourceAtMount has the old; on true unmount they
  // are equal (no further render set sourceRef).
  useEffect(() => {
    const sourceAtMount = source;
    return () => {
      if (activeCleanupRef.current) {
        const reason: 'source-change' | 'unmount' =
          sourceRef.current !== sourceAtMount ? 'source-change' : 'unmount';
        abortControllerRef.current?.abort();
        activeCleanupRef.current({ kind: 'abort', reason });
      } else {
        // No in-flight pipeline; just clear the abort controller defensively.
        abortControllerRef.current = null;
      }
    };
  }, [source]);

  const print = useCallback(async (): Promise<void> => {
    // Re-entry guard (synchronous via ref — must NOT rely on the React state
    // bit because dispatch is batched and a double-click can fire two print()
    // calls before SET_PRINTING commits).
    if (isPrintingRef.current) return;
    const totalPages = pageCountRef.current;
    // Zero-page guard — skip the SET_PRINTING dispatch entirely so the button
    // doesn't flash disabled on an empty document.
    if (totalPages === 0) return;
    const limit = printMaxPagesRef.current;
    if (totalPages > limit) {
      const payload = { type: 'too-large' as const, totalPages, limit };
      dispatch({ type: 'SET_PRINT_ERROR', payload });
      // Fire onPrintError for the too-large phase.
      try {
        callbacksRef.current?.onPrintError?.(
          new Error(`Document has ${totalPages} pages; printMaxPages limit is ${limit}.`),
          { phase: 'too-large' },
        );
      } catch (err) {
        devWarn('[flipbook] consumer onPrintError callback threw; ignoring', err);
      }
      return;
    }

    // Clear stale printError before starting a successful pipeline.
    // Reducer-guarded so this is a no-op when already null (no re-render).
    dispatch({ type: 'CLEAR_PRINT_ERROR' });

    // Snapshot per-job props at start so a mid-print prop change can't
    // mutate this run's scale (would mismatch error diagnostics).
    const scaleForThisJob = printScaleRef.current;
    // performance.now() is monotonic + clock-skew immune (Date.now() can
    // jump backwards on NTP sync, daylight-saving transition, or user clock
    // adjustment, producing negative or absurd durationMs values).
    const startTime = performance.now();

    isPrintingRef.current = true;  // synchronous claim for re-entry guard
    const controller = new AbortController();
    abortControllerRef.current = controller;
    dispatch({ type: 'SET_PRINTING', value: true });

    // Fire onPrintStart.
    try {
      callbacksRef.current?.onPrintStart?.({ totalPages, scale: scaleForThisJob });
    } catch (err) {
      devWarn('[flipbook] consumer onPrintStart callback threw; ignoring', err);
    }

    // Build the print sheet + cleanup via the module-private helpers.
    const { printSheet, objectUrls } = setupPrintSheet();
    const cleanup = makeCleanup({
      printSheet, objectUrls, abortControllerRef, isPrintingRef,
      activeCleanupRef,  // closure nulls itself on idempotent cleanup
      dispatch, startTime, totalPages, callbacksRef,
    });
    activeCleanupRef.current = cleanup;
    // Capture the afterprint handler exposed via makeCleanup so the listener
    // identity is stable for removeEventListener inside cleanup.
    const afterprintHandler = (cleanup as { afterprint?: () => void }).afterprint!;

    try {
      for (let i = 0; i < totalPages; i++) {
        // Abort-check at the TOP of each iteration. The previous iteration's
        // `await new Promise((r) => setTimeout(r, 0))` yield is NOT
        // abort-aware (no signal listener), so a `cancelPrint` / source-change
        // / unmount that fires DURING the yield wouldn't otherwise be
        // observed until the next signal-aware await inside renderPageToBlob
        // — meaning we'd kick off a full unwanted renderPage call first.
        if (controller.signal.aborted) {
          throw new DOMException('Print aborted', 'AbortError');
        }
        let blob: Blob;
        try {
          blob = await renderPageToBlob({
            source, pageIndex: i, scale: scaleForThisJob, signal: controller.signal,
          });
        } catch (err) {
          // Render/blob errors dispatch SET_PRINT_ERROR so the banner
          // surfaces them. AbortError still bubbles to the outer catch.
          if ((err as DOMException)?.name === 'AbortError') throw err;
          // Phase + canvas dims are carried as first-class fields on the
          // typed error subclass — no magic-string parse. Unexpected errors
          // (anything not a PrintBlobConversionError) default to 'render'.
          if (err instanceof PrintBlobConversionError) {
            dispatch({
              type: 'SET_PRINT_ERROR',
              payload: {
                type: 'blob-conversion-failed',
                pageIndex: err.pageIndex,
                canvasWidth: err.canvasWidth,
                canvasHeight: err.canvasHeight,
              },
            });
            cleanup({ kind: 'error', error: err, phase: 'blob' });
          } else {
            const renderErr = err as Error;
            dispatch({
              type: 'SET_PRINT_ERROR',
              payload: { type: 'render-failed', pageIndex: i, message: renderErr.message },
            });
            cleanup({ kind: 'error', error: renderErr, phase: 'render' });
          }
          // cleanup() nulls activeCleanupRef itself; no manual null needed.
          throw err;
        }
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.className = 'fbjs-print-page';
        printSheet.appendChild(img);
        // Wait for the image to fully decode before proceeding to the next
        // page (and ultimately to window.print()). Without this, blob-URL
        // image decoding is async; window.print() can fire before all images
        // are paint-ready → blank pages in the printed output. Decode
        // failures throw and are caught by the per-page error handler below
        // as a render-failed variant.
        try {
          await decodePrintImage({ img, pageIndex: i, signal: controller.signal });
        } catch (err) {
          // Decode failures are a render-phase variant — decodePrintImage
          // throws PrintRenderError with the pageIndex pre-attached. AbortError
          // bubbles through unchanged.
          if ((err as DOMException)?.name === 'AbortError') throw err;
          const renderErr = err as PrintRenderError;
          dispatch({
            type: 'SET_PRINT_ERROR',
            payload: { type: 'render-failed', pageIndex: renderErr.pageIndex ?? i, message: renderErr.message },
          });
          cleanup({ kind: 'error', error: renderErr, phase: 'render' });
          throw err;
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      // Post-loop abort check. CRITICAL: catches cancelPrint / source-change /
      // unmount that fired during the LAST iteration's `setTimeout(0)` yield
      // — by the time control resumes, the loop exits, and without this
      // check we'd proceed to call `window.print()` against a DOM where
      // `printSheet` has already been removed by cleanup. The browser would
      // then print the host page's content (or blanks, depending on
      // `!important` resolution), corrupting the user's output AND
      // contradicting the `onPrintAbort` outcome the cleanup just announced.
      if (controller.signal.aborted) {
        throw new DOMException('Print aborted', 'AbortError');
      }
      // afterprint listener attached BEFORE window.print() so a synchronous
      // afterprint (some headless browsers) can't fire before we're ready.
      window.addEventListener('afterprint', afterprintHandler, { once: true });
      window.print();
      // cleanup runs from the afterprint handler (success outcome).
      // activeCleanupRef is cleared inside cleanup itself.
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        // All three abort triggers (source-change effect cleanup,
        // unmount effect cleanup, `cancelPrint`) invoke `cleanup(...)` BEFORE
        // calling `controller.abort()`, so by the time `AbortError` bubbles
        // here `activeCleanupRef.current` is already null and the guarded
        // cleanup call below short-circuits. The same holds for the
        // `if (controller.signal.aborted) throw new DOMException(...)` checks
        // at the top of each loop iteration and after the loop — the abort
        // was triggered by code that already ran cleanup. The defensive call
        // remains as a safety net against future code paths that might call
        // `abort()` without having run cleanup first; the `'unmount'` reason
        // is arbitrary in that hypothetical case because there's no signal
        // to distinguish which caller set the abort. cleanup() is idempotent
        // (cleanedUp flag) — no double-cleanup even if already invoked.
        if (activeCleanupRef.current !== null) {
          cleanup({ kind: 'abort', reason: 'unmount' });
        }
        return;
      }
      // Render/blob errors already dispatched + invoked cleanup above.
      // Other unexpected errors: invoke cleanup defensively + rethrow.
      // cleanup() nulls activeCleanupRef itself.
      if (activeCleanupRef.current !== null) {
        cleanup({ kind: 'error', error: err as Error, phase: 'render' });
      }
      devWarn('[flipbook] print pipeline failed', err);
      throw err;
    }
  }, [dispatch, source, callbacksRef]);

  // User-initiated cancel (escape from KL12/KL23 — dialog left open / WebView
  // afterprint never fires). Snapshot BOTH the cleanup closure AND the
  // controller BEFORE invoking cleanup — cleanup nulls `abortControllerRef`
  // as part of its body, so reading `abortControllerRef.current` after
  // cleanup runs would return null and the `.abort()` call would silently
  // no-op (leaving in-flight `renderPage` / `decode` running and blob-URL
  // decode potentially hanging forever; see KL22). Cleanup runs first so the
  // outcome reason is `'user-cancel'`; the subsequent abort fires any
  // in-flight renderPage/decode listeners which bubble AbortError up through
  // the for-loop catch — by then activeCleanupRef.current is null, so the
  // catch's `if (activeCleanupRef.current)` short-circuits and the
  // `'user-cancel'` reason wins.
  const cancelPrint = useCallback((): void => {
    const cleanup = activeCleanupRef.current;
    const controller = abortControllerRef.current;
    if (!cleanup) return;
    cleanup({ kind: 'abort', reason: 'user-cancel' });
    controller?.abort();
  }, []);

  return { print, cancelPrint };
}
