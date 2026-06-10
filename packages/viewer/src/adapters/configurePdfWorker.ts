import * as pdfjs from 'pdfjs-dist';

let workerConfigured = false;

/**
 * Configure the pdfjs web worker.
 *
 * Default: bundled asset URL via import.meta.url resolution.
 * Override: pass a custom workerSrc URL.
 *
 * NOTE: The default strategy is a PLACEHOLDER. Week 0 Experiment 3
 * will validate whether this works from a pre-built library bundle.
 * If not, this will change to either:
 * - True blob URL inlining (worker source embedded as string)
 * - User-required configuration (externalize pdfjs-dist)
 */
export function configurePdfWorker(workerSrc?: string): void {
  // Explicit workerSrc always wins — allows overriding a previous default.
  // Calling without args after the default is set is a no-op.
  if (workerConfigured && !workerSrc) return;

  if (workerSrc) {
    // User-provided worker URL (advanced usage).
    // Must be called before the first PdfjsSource.init().
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  } else {
    // Default: resolve worker as a bundled asset.
    // import.meta.url tells the bundler to copy pdf.worker.min.mjs
    // to the output directory and rewrite this URL to point to it.
    //
    // This works when:
    //   - The user's bundler processes our source (Webpack 5, Vite)
    // This breaks when:
    //   - We ship a pre-built bundle (URL baked in at our build time)
    //   - Next.js SSR (import.meta.url doesn't exist on the server)
    //
    // Week 0 will determine the real approach.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  }

  workerConfigured = true;
}
