import { PdfjsSource } from '@flipbookjs/react-viewer';
import type { PageSource, PdfjsSourceOptions } from '@flipbookjs/react-viewer';
import { PreRenderedPageSource } from './PreRenderedPageSource';
import type { FlipbookDocument, FlipbookDocumentStatus } from './FlipbookDocument';
// FlipbookDocumentStatus IS imported — used only by the `satisfies` cast on
// the KNOWN_STATUSES array literal below, which compile-links the runtime
// guard to the type union. If a future contract v2 adds a status to the
// union without updating this array (or vice versa), the `satisfies` fails
// tsc and the drift is caught at build time.

export interface CreateFlipbookSourceOptions {
  /**
   * Fetch credentials policy for the `PreRenderedPageSource` branch
   * (status `'ready'` or `'stale'` with bundle present). Forwarded to
   * the underlying `fetch()` calls the bundle reader makes for
   * `manifest.json` + per-page image tiles.
   *
   * **Why this exists alongside `pdfjs.withCredentials`:** the two
   * source classes use different request mechanisms. `PreRenderedPageSource`
   * uses `fetch()`, whose credentials policy is expressed as
   * `RequestCredentials`. `PdfjsSource` delegates to PDF.js, which has
   * its own XHR-style `withCredentials: boolean`. Set whichever applies
   * to the branch your document lands in. Setting both is harmless —
   * each is ignored by the unrelated branch.
   */
  credentials?: RequestCredentials;
  /**
   * Options forwarded to `PdfjsSource`'s second constructor argument
   * when the helper falls back to PDF.js (any status that isn't
   * `'ready'`/`'stale'` with bundle). The `url` is supplied separately
   * from `FlipbookDocument.sourcePdfUrl` and is not part of this object.
   *
   * Use `pdfjs.withCredentials: true` if you need credentials sent with
   * the PDF.js fetch — that's the PDF.js-side equivalent of the
   * top-level `credentials` option above.
   */
  pdfjs?: PdfjsSourceOptions;
}

// Runtime guard against CMS-side status drift. The TypeScript type is
// exhaustive at compile time; this array is the runtime defense.
// The `satisfies FlipbookDocumentStatus[]` cast forces the array to be a
// tuple of valid FlipbookDocumentStatus values. If the array is missing
// a member of the union (drift after a v2 contract adds one), tsc will
// NOT catch it — `satisfies` widens, doesn't narrow. To make drift
// detectable at BOTH directions, the array is tuple-literal + we use an
// exhaustiveness check on the union via a never-check helper:
const KNOWN_STATUSES_LIST = [
  'uploaded', 'converting', 'ready', 'failed', 'stale',
] as const satisfies readonly FlipbookDocumentStatus[];

// Compile-time exhaustiveness check: this line fails tsc if the tuple
// literal above is missing any member of FlipbookDocumentStatus.
// Explanation: (typeof KNOWN_STATUSES_LIST)[number] is the tuple's value
// union. If it doesn't cover FlipbookDocumentStatus, the type-argument
// assignment fails. Runtime footprint: one tree-shakable boolean const —
// with `sideEffects: false` on the adapter package.json (see §10.2),
// consumer bundlers drop the unused binding entirely.
const _assertKnownStatusesCoversUnion: (typeof KNOWN_STATUSES_LIST)[number] extends FlipbookDocumentStatus
  ? FlipbookDocumentStatus extends (typeof KNOWN_STATUSES_LIST)[number]
    ? true
    : never
  : never = true;

const KNOWN_STATUSES = new Set<string>(KNOWN_STATUSES_LIST);

/** True when running in a non-production environment. Defensive against
 *  bundlers that don't replace `process.env.NODE_ENV` at build time and
 *  consumer environments where `process` is undefined entirely. */
function isDevMode(): boolean {
  if (typeof process === 'undefined') return false;
  // process exists; check NODE_ENV. Some build environments set it to
  // unusual strings; treat anything that's not the literal 'production'
  // as dev-mode for warning purposes.
  return process.env?.NODE_ENV !== 'production';
}

export function createFlipbookSource(
  doc: FlipbookDocument,
  options: CreateFlipbookSourceOptions = {},
): PageSource {
  // Defensive: unknown status → degrade to PdfjsSource + dev warn.
  // Structural defense against the CMS adding a status without a v2 contract bump.
  // (`as string` widens for the runtime check; doc.status's typed union narrows
  // at compile time but the runtime value can be anything from the wire.)
  if (!KNOWN_STATUSES.has(doc.status as string)) {
    if (isDevMode()) {
      console.warn(
        `[flipbookjs] createFlipbookSource: unknown FlipbookDocument.status `
        + `'${doc.status}' on doc id='${doc.id}'. Falling back to PdfjsSource. `
        + `Verify your @flipbookjs/api-adapter version matches the CMS's `
        + `FlipbookDocument contract.`,
      );
    }
    return new PdfjsSource(doc.sourcePdfUrl, options.pdfjs);
  }

  // Ready / stale-with-bundle: pre-rendered.
  if (
    (doc.status === 'ready' || doc.status === 'stale')
    && doc.artifactManifestUrl
  ) {
    return new PreRenderedPageSource({
      bundleUrl: doc.artifactManifestUrl,
      credentials: options.credentials,
    });
  }

  // Defensive: ready-but-URL-missing is documented shape drift.
  // Dev-mode warn so the consumer sees it instead of silently degrading.
  if (doc.status === 'ready' && !doc.artifactManifestUrl) {
    if (isDevMode()) {
      console.warn(
        `[flipbookjs] createFlipbookSource: FlipbookDocument id='${doc.id}' `
        + `has status='ready' but artifactManifestUrl is missing. This `
        + `indicates shape drift on the CMS side. Falling back to PdfjsSource.`,
      );
    }
  }

  // Everything else: PDF.js fallback. PdfjsSource constructor signature is
  // (url: string | URL | Uint8Array, options?: PdfjsSourceOptions) — url is
  // POSITIONAL, not part of the options object.
  return new PdfjsSource(doc.sourcePdfUrl, options.pdfjs);
}
