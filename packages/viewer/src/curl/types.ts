/**
 * Internal curl types and assertion helper.
 *
 * The OLD fork's curl files import from `./types`. To avoid rewriting those
 * imports across 6 files during lift-and-shift, this file mirrors the old
 * structure but re-exports PageRegistryEntry from its authoritative location
 * (`../core/PageRegistry`) instead of defining it here.
 */

export type { PageRegistryEntry } from '../core/PageRegistry';

/**
 * Programmatic curl trigger API. Returned internally by useCurlMode.
 * Copied verbatim from old fork's types.ts.
 *
 * Per architectural plan Decision D: ported but NOT exposed via public API in v0.1.
 */
export interface CurlController {
  isAnimating: () => boolean;
  startCurl: (direction: 'next' | 'previous', commitFn: () => Promise<void>) => void;
  /** Cancel any in-progress animation and return to idle. */
  cancel: () => void;
}

/**
 * Dev-mode assertion utility — warns on falsy condition, never throws.
 * Design intent (from old fork): curl rendering should degrade gracefully
 * rather than crash. A bad invariant warns in dev and the curl continues.
 *
 * NOTE: `asserts condition` type narrowing is NOT available with a non-throwing
 * function. Callers cannot rely on type narrowing after curlAssert.
 */
const IS_DEV = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

export const curlAssert = (
  condition: boolean,
  context: string,
  message: string,
  data?: Record<string, unknown>,
): void => {
  if (IS_DEV && !condition) {
    console.warn(`[PageCurl:${context}] ${message}`, data ?? '');
  }
};
