// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isTrustedDownloadUrl } from '../core/isTrustedDownloadUrl';

// jsdom serves this suite from http://localhost:3000, so relative and
// protocol-relative inputs resolve to an http: origin.
describe('isTrustedDownloadUrl', () => {
  it.each([
    'https://cdn.example.com/a.pdf',
    'http://cdn.example.com/a.pdf',
    '/docs/a.pdf',
    'a.pdf',
    // Protocol-relative: inherits the page's scheme, so it is http: here.
    // Pinned deliberately — it is a legitimate CDN form, not an oversight.
    '//cdn.example.com/a.pdf',
  ])('accepts %s', (url) => {
    expect(isTrustedDownloadUrl(url)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    // The three forms a `startsWith('http')` check would wave through: the URL
    // parser strips leading whitespace and lower-cases the scheme before the
    // protocol is read, so all three are caught.
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    '\tjavascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:application/pdf;base64,AAAA',
    'blob:http://localhost/abc',
    'file:///etc/passwd',
    'ftp://example.com/a.pdf',
    // Empty and whitespace-only resolve to the page URL and would report
    // http: without the explicit length check in the guard.
    '',
    '   ',
  ])('rejects %s', (url) => {
    expect(isTrustedDownloadUrl(url)).toBe(false);
  });
});
