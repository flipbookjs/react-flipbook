import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../core/sanitizeFilename';

describe('sanitizeFilename', () => {
  it('passes a plain string through with .pdf appended', () => {
    expect(sanitizeFilename('My Doc')).toBe('My Doc.pdf');
  });

  it('is idempotent on input already ending in .pdf', () => {
    expect(sanitizeFilename('My Doc.pdf')).toBe('My Doc.pdf');
  });

  it('normalizes case-insensitive .PDF extension to lowercase .pdf', () => {
    expect(sanitizeFilename('My Doc.PDF')).toBe('My Doc.pdf');
  });

  it('strips Windows-illegal characters', () => {
    expect(sanitizeFilename('Hello<>:"/\\|?*World')).toBe('HelloWorld.pdf');
  });

  it('strips C0 control characters', () => {
    expect(sanitizeFilename('Hi\x00\x01\x1FBye')).toBe('HiBye.pdf');
  });

  it('collapses internal whitespace runs to a single space (after C0 controls are stripped)', () => {
    // \t (0x09) and \n (0x0A) are in the C0 strip range — removed in step 1
    // BEFORE the \s+ collapse in step 2. So the tab+newline between "there"
    // and "friend" leaves no gap; the 3-space run collapses to a single space.
    expect(sanitizeFilename('Hi   there\t\nfriend')).toBe('Hi therefriend.pdf');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeFilename('  Doc  ')).toBe('Doc.pdf');
  });

  it('falls back to "document" for empty input', () => {
    expect(sanitizeFilename('')).toBe('document.pdf');
  });

  it('falls back to "document" when every character is stripped', () => {
    expect(sanitizeFilename('<>:"/\\|?*')).toBe('document.pdf');
  });

  it('prefixes Windows reserved name CON with _', () => {
    expect(sanitizeFilename('CON')).toBe('_CON.pdf');
  });

  it('prefixes Windows reserved name with extension (NUL.pdf) with _', () => {
    expect(sanitizeFilename('NUL.pdf')).toBe('_NUL.pdf');
  });

  it('preserves Unicode characters (日本語ドキュメント)', () => {
    expect(sanitizeFilename('日本語ドキュメント')).toBe('日本語ドキュメント.pdf');
  });

  it('caps the base name at 200 chars using extension-aware truncation', () => {
    // Without extension: 250 'a' chars → 200 'a' chars + '.pdf'.
    expect(sanitizeFilename('a'.repeat(250))).toBe('a'.repeat(200) + '.pdf');
    // With .pdf extension: same result — the .pdf is stripped, the 250-char
    // base is capped to 200, then .pdf is reattached. Truncation never
    // lands inside the extension.
    expect(sanitizeFilename('a'.repeat(250) + '.pdf')).toBe('a'.repeat(200) + '.pdf');
  });

  it('strips display-hostile / spoofing-friendly characters (bidi overrides, BOM, DEL)', () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE — the classic extension-reversal trick.
    expect(sanitizeFilename('exploit\u202Etxt.pdf')).toBe('exploittxt.pdf');
    // U+202A + U+2066 + U+FEFF — other bidi-override controls + zero-width BOM.
    expect(sanitizeFilename('Doc\u202A\u2066﻿.pdf')).toBe('Doc.pdf');
    // DEL 0x7F — OS-legal but blank-rendering in most shells.
    expect(sanitizeFilename('Hi\x7FBye')).toBe('HiBye.pdf');
  });
});
