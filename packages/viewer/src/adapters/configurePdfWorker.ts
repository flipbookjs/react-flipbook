import * as pdfjs from 'pdfjs-dist';

/**
 * Register the pdf.js web worker.
 *
 * Resolution order:
 * 1. `workerSrc` argument (also reachable as `PdfjsSourceOptions.workerSrc`) — wins.
 * 2. An already-set `pdfjs.GlobalWorkerOptions.workerSrc` — respected, never
 *    overwritten. Since pdfjs-dist is a peer, that global belongs to the consumer's
 *    application, which may configure pdf.js for its own use.
 * 3. Neither — throws. There is no default: the worker is required for every
 *    document, and pdf.js's fallback path re-imports the same URL, so a wrong or
 *    unreachable default fails hard rather than degrading.
 *
 * The worker MUST come from the same pdfjs-dist version as the library; pdf.js
 * compares the two and throws `The API version "X" does not match the Worker version
 * "Y"`.
 *
 * Environment note: under Node, pdf.js's own static initializer runs
 * `GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs"`, and its `isNodeJS` check is
 * true whenever `process` exists — including jsdom test environments. Step 3 is
 * therefore a browser-path guard.
 */
export function configurePdfWorker(workerSrc?: string): void {
  if (workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    return;
  }

  if (pdfjs.GlobalWorkerOptions.workerSrc) return;

  throw new Error(
    '[flipbook] pdf.js worker is not configured. Pass a URL to the worker that ships ' +
    'with your installed pdfjs-dist — e.g. ' +
    "import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url' — as " +
    'configurePdfWorker(workerSrc) at app startup, or as ' +
    '<Flipbook pdfjsOptions={{ workerSrc }} />. Setting ' +
    'pdfjs.GlobalWorkerOptions.workerSrc yourself also works.',
  );
}
