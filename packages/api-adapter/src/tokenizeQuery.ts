// Pure-TypeScript implementation of the §3.4 tokenizer pipeline. MUST match
// the Rust `publi-flipbook-api::search::build_tokens` output byte-for-byte on
// the 10k-input parity corpus (`__fixtures__/tokenize-parity-goldens.json`).
//
// Two stages, mirroring the Rust split:
//   Stage 1 — UAX-29 word segmentation via `Intl.Segmenter` with explicit
//             `'en'` locale (no Thai/Lao tailoring; deterministic across hosts
//             regardless of process LANG). Filter to segments containing at
//             least one alphanumeric scalar — same predicate Rust's
//             `is_word_segment` applies via `char::is_alphanumeric()` (Unicode
//             categories L | N).
//   Stage 2 — `processTerm`: NFD-decompose → strip combining marks (categories
//             Mn | Mc | Me, matching `unicode_normalization::char::is_combining_mark`)
//             → lowercase → NFC-recompose.
//
// `Intl.Segmenter` (ES2022) + `String.prototype.normalize` are both required
// at Node `>=20.19` and all modern browsers per the locked package.json
// minimums — no fallback path.

export interface QueryToken {
  /** Folded form — case- and diacritic-folded, NFC-normalized. */
  text: string;
}

const SEGMENTER = new Intl.Segmenter('en', { granularity: 'word' });
const ALPHANUMERIC_CHAR = /[\p{L}\p{N}]/u;
const COMBINING_MARK = /^\p{M}$/u;

export function tokenizeQuery(query: string): QueryToken[] {
  const out: QueryToken[] = [];
  for (const seg of SEGMENTER.segment(query)) {
    if (!hasAlphanumeric(seg.segment)) continue;
    const text = processTerm(seg.segment);
    if (text.length === 0) continue;
    out.push({ text });
  }
  return out;
}

function hasAlphanumeric(s: string): boolean {
  // Iterate by Unicode scalar (string iterator does this) — `s.length` on a
  // surrogate pair would mis-index.
  for (const c of s) {
    if (ALPHANUMERIC_CHAR.test(c)) return true;
  }
  return false;
}

/**
 * Stage 2 folding: NFD-decompose → strip combining marks → lowercase →
 * NFC-recompose. Pure function; safe on any string. Empty in → empty out.
 *
 * Exported so the parity-goldens vitest can call it directly (the Rust side
 * exposes `process_term` as a `pub fn`; the TS side mirrors that surface).
 */
export function processTerm(raw: string): string {
  if (raw.length === 0) return '';
  const nfd = raw.normalize('NFD');
  let stripped = '';
  for (const c of nfd) {
    if (!COMBINING_MARK.test(c)) stripped += c;
  }
  // `toLowerCase()` uses the default Unicode case mapping (no host-locale
  // tailoring); matches Rust's `str::to_lowercase()`. `toLocaleLowerCase()`
  // would diverge under Turkish locale and is deliberately NOT used.
  return stripped.toLowerCase().normalize('NFC');
}
