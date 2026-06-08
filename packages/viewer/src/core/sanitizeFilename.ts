/**
 * Sanitize a raw string for use as a download filename. Strips OS-illegal
 * characters AND a small set of OS-legal-but-display-hostile characters
 * (DEL 0x7F, Unicode bidi-override controls U+202A-U+202E and U+2066-U+2069,
 * zero-width BOM U+FEFF) to prevent filename-display spoofing — e.g., the
 * classic `exploit.txt.pdf` → `exploit‮txt.pdf` extension-reversal trick
 * that some file managers render as `exploitfdp.txt`. The forced final `.pdf`
 * suffix limits the blast radius, but the visible BODY of the filename is
 * also a trust signal end-users read. Collapses whitespace, handles Windows
 * reserved names (CON / PRN / AUX / NUL / COM[1-9] / LPT[1-9]), falls back
 * to `'document'` for empty input, caps the base name at 200 characters to
 * stay under common filesystem limits (NTFS 255 / ext4 255 / APFS 255 —
 * leaving headroom for the `.pdf` suffix + any browser-side disambiguation
 * suffix), and ensures a single `.pdf` extension (idempotent — input already
 * ending in `.pdf` is not double-suffixed).
 *
 * NOT exported from the package public API. Used only by `FlipbookProvider`'s
 * `actions.download()` body — kept here as a standalone module rather than
 * inline because the helper has 14+ boundary cases worth unit-testing in
 * isolation (`src/__tests__/sanitizeFilename.test.ts`).
 */
export function sanitizeFilename(raw: string): string {
  // Illegal on Windows: < > : " / \ | ? *  AND C0 control chars (0x00-0x1F).
  // Illegal on macOS/Linux in practice: / (path separator) and NUL.
  // ALSO stripped (OS-legal but display-hostile / trust-signal hostile):
  //   - DEL (0x7F): renders blank in most shells.
  //   - U+202A-U+202E + U+2066-U+2069: Unicode bidi-override controls
  //     used in extension-reversal spoofing attacks.
  //   - U+FEFF: zero-width BOM — invisible.
  // Collapse internal whitespace and trim after stripping. We use explicit
  // `\uNNNN` escapes for the bidi controls + BOM so the regex source stays
  // readable (the literal characters are invisible on screen).
  const stripped = raw
    .replace(/[<>:"/\\|?*\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Empty after stripping → fall back to the default.
  const safe = stripped.length > 0 ? stripped : 'document';

  // Windows reserved device names (case-insensitive, with or without
  // extension). Prefix with `_` to make the name legal while keeping the
  // user's intent recognizable.
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  const reservedSafe = reserved.test(safe) ? `_${safe}` : safe;

  // Cap the BASE NAME (i.e., excluding any existing `.pdf` extension) at 200
  // characters to stay safely under common filesystem name limits (255 on
  // NTFS/ext4/APFS) while leaving headroom for the `.pdf` suffix AND for any
  // browser-side disambiguation suffix like ` (1)`. Operating on the base
  // (not the whole string) ensures we never truncate INTO the extension —
  // e.g., `<200-char-name>.pdf` stays intact, and a 250-char base name gets
  // trimmed to 200 chars before the `.pdf` is reattached.
  const hasExt = /\.pdf$/i.test(reservedSafe);
  const baseName = hasExt ? reservedSafe.slice(0, -4) : reservedSafe;
  const cappedBase = baseName.slice(0, 200);

  // Reattach the `.pdf` extension. The regex is case-insensitive so an input
  // already in `.PDF` form would have had its extension stripped above and
  // is now lowercased back to `.pdf` — acceptable normalization. (Tests
  // accept either case because both are OS-legal.)
  return `${cappedBase}.pdf`;
}
