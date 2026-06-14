/**
 * G6 — validator suite per the plan's enumerated test list. 38 it() blocks
 * total covering D14 Part 1/2/3 + D13 uniform-page + SDR1 cross-constraint +
 * open-schema posture.
 *
 * The validator operates on plain JSON objects — no HTTP, no DOM beyond
 * window.location.origin for the host-policy tests. We use jsdom's default
 * origin (`http://localhost`) and stub it via Object.defineProperty for the
 * cross-origin / opaque / no-window edges.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { validateManifest } from '../validateManifest';

// ---- Fixture helpers ----

/**
 * Returns a fresh well-formed manifest object on every call. Tests mutate
 * copies; never mutate the result of a previous call.
 */
function makeManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: 1,
    documentId: 'doc_test',
    contentHash: 'sha256:abc',
    status: 'ready',
    generatedAt: '2026-06-14T00:00:00Z',
    pageCount: 3,
    defaults: {
      widths: [512, 1024, 2048, 4096],
      format: 'webp',
      tierUrlTemplate: 'pages/{page}/width-{width}.{format}',
      sidecarUrlTemplate: 'pages/{page}/{sidecar}.json',
      pageNumberDigits: 4,
    },
    pages: [
      { size: [594, 792], rotation: 0 },
      { size: [594, 792], rotation: 0 },
      { size: [594, 792], rotation: 0 },
    ],
    documentArtifacts: {
      outline: 'outline.json',
    },
    ...overrides,
  };
}

// ---- Cleanup ----

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---- Tests ----

describe('validateManifest', () => {
  describe('happy path', () => {
    it('returns typed Manifest for a well-formed fixture', () => {
      const m = validateManifest(makeManifest());
      expect(m.manifestVersion).toBe(1);
      expect(m.documentId).toBe('doc_test');
      expect(m.pageCount).toBe(3);
      expect(m.pages).toHaveLength(3);
      expect(m.defaults.widths).toEqual([512, 1024, 2048, 4096]);
    });
  });

  describe('structural rules (D14 Part 3)', () => {
    it('rejects manifestVersion !== 1', () => {
      expect(() => validateManifest(makeManifest({ manifestVersion: 2 }))).toThrow(/manifestVersion/);
      expect(() => validateManifest(makeManifest({ manifestVersion: '1' }))).toThrow(/manifestVersion/);
      expect(() => validateManifest(makeManifest({ manifestVersion: undefined }))).toThrow(/manifestVersion/);
    });

    it('rejects pageCount mismatch (pages.length)', () => {
      const m = makeManifest({ pageCount: 3, pages: [{ size: [594, 792], rotation: 0 }, { size: [594, 792], rotation: 0 }] });
      expect(() => validateManifest(m)).toThrow(/pages.length \(2\) must equal pageCount \(3\)/);
    });

    it('rejects non-positive page.size dimensions', () => {
      const m = makeManifest({ pages: [{ size: [0, 792], rotation: 0 }, { size: [0, 792], rotation: 0 }, { size: [0, 792], rotation: 0 }] });
      expect(() => validateManifest(m)).toThrow(/size.*positive/);
    });

    it('rejects rotation values not in {0, 90, 180, 270}', () => {
      const m = makeManifest({ pages: [{ size: [594, 792], rotation: 45 }, { size: [594, 792], rotation: 0 }, { size: [594, 792], rotation: 0 }] });
      expect(() => validateManifest(m)).toThrow(/rotation must be 0\|90\|180\|270; got 45/);
    });

    it('rejects empty defaults.widths', () => {
      const m = makeManifest({ defaults: { ...(makeManifest().defaults as object), widths: [] } });
      expect(() => validateManifest(m)).toThrow(/defaults\.widths must be a non-empty array/);
    });

    it('rejects defaults.widths with duplicate or non-positive entries', () => {
      const dupes = makeManifest({ defaults: { ...(makeManifest().defaults as object), widths: [512, 512, 1024] } });
      expect(() => validateManifest(dupes)).toThrow(/sorted strictly ascending/);
      const negatives = makeManifest({ defaults: { ...(makeManifest().defaults as object), widths: [-1, 1024] } });
      expect(() => validateManifest(negatives)).toThrow(/positive integer/);
    });

    it('rejects template strings missing required placeholders', () => {
      const noPage = makeManifest({ defaults: { ...(makeManifest().defaults as object), tierUrlTemplate: 'width-{width}.{format}' } });
      expect(() => validateManifest(noPage)).toThrow(/tierUrlTemplate.*\{page\}/);
      const noSidecar = makeManifest({ defaults: { ...(makeManifest().defaults as object), sidecarUrlTemplate: 'pages/{page}.json' } });
      expect(() => validateManifest(noSidecar)).toThrow(/sidecarUrlTemplate.*\{sidecar\}/);
    });

    it('rejects pageNumberDigits outside [1, 9]', () => {
      const zero = makeManifest({ defaults: { ...(makeManifest().defaults as object), pageNumberDigits: 0 } });
      expect(() => validateManifest(zero)).toThrow(/pageNumberDigits.*\[1, 9\]/);
      const ten = makeManifest({ defaults: { ...(makeManifest().defaults as object), pageNumberDigits: 10 } });
      expect(() => validateManifest(ten)).toThrow(/pageNumberDigits.*\[1, 9\]/);
    });

    it('rejects pageNumberDigits insufficient for pageCount (e.g., digits=1 with pageCount=15) — SDR1 cross-constraint', () => {
      const pages = Array.from({ length: 15 }, () => ({ size: [594, 792], rotation: 0 }));
      const m = makeManifest({
        pageCount: 15,
        pages,
        defaults: { ...(makeManifest().defaults as object), pageNumberDigits: 1 },
      });
      expect(() => validateManifest(m)).toThrow(/pageNumberDigits=1.*9 pages.*pageCount=15.*at least 2 digits/);
    });
  });

  describe('open-schema posture (D14 unknown-field policy)', () => {
    it('accepts manifest with unrecognized top-level field (forward-compat additive)', () => {
      const m = makeManifest({ futureField: 'foo' });
      expect(() => validateManifest(m)).not.toThrow();
    });

    it('accepts manifest with unrecognized field under defaults.* (forward-compat additive)', () => {
      const m = makeManifest({ defaults: { ...(makeManifest().defaults as object), futureFlag: true } });
      expect(() => validateManifest(m)).not.toThrow();
    });

    it('accepts manifest with unrecognized field under pages[i] (forward-compat additive)', () => {
      const m = makeManifest({
        pages: [
          { size: [594, 792], rotation: 0, futureMeta: 'x' },
          { size: [594, 792], rotation: 0 },
          { size: [594, 792], rotation: 0 },
        ],
      });
      expect(() => validateManifest(m)).not.toThrow();
    });
  });

  describe('uniform page constraint (D13)', () => {
    it('rejects manifest with mixed page sizes within a document', () => {
      const m = makeManifest({
        pages: [
          { size: [594, 792], rotation: 0 },
          { size: [612, 792], rotation: 0 },
          { size: [594, 792], rotation: 0 },
        ],
      });
      expect(() => validateManifest(m)).toThrow(/D13: uniform page size required/);
    });

    it('rejects manifest with mixed page rotations within a document', () => {
      const m = makeManifest({
        pages: [
          { size: [594, 792], rotation: 0 },
          { size: [594, 792], rotation: 90 },
          { size: [594, 792], rotation: 0 },
        ],
      });
      expect(() => validateManifest(m)).toThrow(/D13: uniform rotation required/);
    });
  });

  describe('URL safety for refs (D14 Part 1)', () => {
    function withOutline(outline: string): Record<string, unknown> {
      return makeManifest({ documentArtifacts: { outline } });
    }

    it('rejects artifact ref with a lowercase scheme prefix (https://, javascript:, data:)', () => {
      expect(() => validateManifest(withOutline('https://evil.com/x.json'))).toThrow(/scheme-prefixed URL/);
      expect(() => validateManifest(withOutline('javascript:alert(1)'))).toThrow(/scheme-prefixed URL/);
      expect(() => validateManifest(withOutline('data:text/html,<x>'))).toThrow(/scheme-prefixed URL/);
    });

    it('rejects artifact ref with a mixed-case scheme prefix (JavaScript:, Data:, HTTPS://) — case-insensitive', () => {
      expect(() => validateManifest(withOutline('JavaScript:foo'))).toThrow(/scheme-prefixed URL/);
      expect(() => validateManifest(withOutline('Data:text/plain,x'))).toThrow(/scheme-prefixed URL/);
      expect(() => validateManifest(withOutline('HTTPS://x.com/x'))).toThrow(/scheme-prefixed URL/);
    });

    it('rejects artifact ref with a non-alphabetic-leading scheme (chrome-extension:, ms-windows-store:)', () => {
      expect(() => validateManifest(withOutline('chrome-extension://abc/x.json'))).toThrow(/scheme-prefixed URL/);
      expect(() => validateManifest(withOutline('ms-windows-store:foo'))).toThrow(/scheme-prefixed URL/);
    });

    it('rejects protocol-relative artifact ref (//cdn.example.com/x.webp)', () => {
      expect(() => validateManifest(withOutline('//cdn.example.com/outline.json'))).toThrow(/protocol-relative/);
    });

    it('rejects artifact ref containing `..` as a path segment', () => {
      expect(() => validateManifest(withOutline('../secret.json'))).toThrow(/'\.\.' path segment/);
      expect(() => validateManifest(withOutline('pages/../../etc/passwd'))).toThrow(/'\.\.' path segment/);
    });

    it('rejects artifact ref containing backslash', () => {
      expect(() => validateManifest(withOutline('pages\\0001\\outline.json'))).toThrow(/backslash/);
    });

    it('rejects artifact ref containing control chars (\\x00, \\x1F, \\x7F)', () => {
      expect(() => validateManifest(withOutline('outline\x00.json'))).toThrow(/control characters/);
      expect(() => validateManifest(withOutline('outline\x1F.json'))).toThrow(/control characters/);
      expect(() => validateManifest(withOutline('outline\x7F.json'))).toThrow(/control characters/);
    });

    it('rejects artifact ref with leading or trailing whitespace', () => {
      expect(() => validateManifest(withOutline(' outline.json'))).toThrow(/whitespace/);
      expect(() => validateManifest(withOutline('outline.json '))).toThrow(/whitespace/);
    });
  });

  describe('URL safety for sourcePdf (D14 Part 2)', () => {
    function withSourcePdf(sourcePdf: string, bundleUrl?: string): { manifest: Record<string, unknown>; bundleUrl?: string } {
      const m = makeManifest({
        documentArtifacts: { outline: 'outline.json', sourcePdf },
      });
      return { manifest: m, bundleUrl };
    }

    it('accepts sourcePdf as a relative bundle path (passes Part 1)', () => {
      const { manifest } = withSourcePdf('source.pdf');
      expect(() => validateManifest(manifest)).not.toThrow();
    });

    it('accepts sourcePdf as an absolute https:// URL within same origin as bundleUrl', () => {
      const { manifest, bundleUrl } = withSourcePdf('https://cdn.example.com/source.pdf', 'https://cdn.example.com/bundle');
      expect(() => validateManifest(manifest, bundleUrl)).not.toThrow();
    });

    it('accepts sourcePdf as an absolute HTTPS:// URL (case-insensitive scheme)', () => {
      const { manifest, bundleUrl } = withSourcePdf('HTTPS://cdn.example.com/source.pdf', 'https://cdn.example.com/bundle');
      expect(() => validateManifest(manifest, bundleUrl)).not.toThrow();
    });

    it('rejects sourcePdf with javascript: / data: / file: / vbscript: / blob: schemes', () => {
      for (const ref of ['javascript:alert(1)', 'data:text/html,<x>', 'file:///etc/passwd', 'vbscript:foo', 'blob:abc']) {
        const { manifest } = withSourcePdf(ref);
        expect(() => validateManifest(manifest)).toThrow();
      }
    });

    it('rejects sourcePdf with a non-http(s) absolute URL (chrome-extension://, ftp://)', () => {
      const { manifest: m1 } = withSourcePdf('chrome-extension://abc/source.pdf');
      expect(() => validateManifest(m1)).toThrow(/relative path or an absolute http\(s\)/);
      const { manifest: m2 } = withSourcePdf('ftp://cdn.example.com/source.pdf');
      expect(() => validateManifest(m2)).toThrow(/relative path or an absolute http\(s\)/);
    });

    it('rejects sourcePdf that fails new URL() parsing', () => {
      const { manifest } = withSourcePdf('https://[invalid', 'https://cdn.example.com/bundle');
      expect(() => validateManifest(manifest, 'https://cdn.example.com/bundle')).toThrow(/not a valid URL/);
    });

    it('rejects absolute sourcePdf with cross-origin host vs absolute bundleUrl (host policy default)', () => {
      const { manifest } = withSourcePdf('https://other-cdn.com/source.pdf', 'https://cdn.example.com/bundle');
      expect(() => validateManifest(manifest, 'https://cdn.example.com/bundle')).toThrow(/cross-origin not permitted/);
    });

    it('rejects absolute sourcePdf with cross-origin host vs window.location.origin when bundleUrl is relative', () => {
      // jsdom default origin is 'http://localhost:3000' or similar. Use a sourcePdf with a different origin.
      const { manifest } = withSourcePdf('https://other-cdn.com/source.pdf');
      expect(() => validateManifest(manifest, '/relative-bundle')).toThrow(/cross-origin not permitted/);
    });

    it('rejects absolute sourcePdf when window.location.origin is "null" (file://, sandboxed iframe) — refuse to decide', () => {
      const originalOrigin = window.location.origin;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...window.location, origin: 'null' },
      });
      try {
        const { manifest } = withSourcePdf('https://cdn.example.com/source.pdf');
        expect(() => validateManifest(manifest, '/relative-bundle')).toThrow(/window\.location\.origin is "null"/);
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          value: { ...window.location, origin: originalOrigin },
        });
      }
    });

    it('rejects absolute sourcePdf when window is unavailable (defensive, since adapter is browser-only per A7)', () => {
      vi.stubGlobal('window', undefined);
      const { manifest } = withSourcePdf('https://cdn.example.com/source.pdf');
      expect(() => validateManifest(manifest, '/relative-bundle')).toThrow(/window is not available/);
    });
  });

  describe('overrides (D14 Part 3)', () => {
    function withOverrides(overrides: Record<string, unknown>): Record<string, unknown> {
      return makeManifest({ overrides });
    }

    it('accepts override keys that are zero-padded page IDs matching pageNumberDigits', () => {
      const m = withOverrides({ '0001': { widths: [512, 1024] } });
      expect(() => validateManifest(m)).not.toThrow();
    });

    it('rejects override keys that do NOT match ^\\d{N}$ (wrong length, non-digit chars)', () => {
      expect(() => validateManifest(withOverrides({ '0001x': { widths: [512] } }))).toThrow(/must match/);
      expect(() => validateManifest(withOverrides({ '1': { widths: [512] } }))).toThrow(/must match/);
      expect(() => validateManifest(withOverrides({ 'foo': { widths: [512] } }))).toThrow(/must match/);
    });

    it('rejects override keys parsing to integers outside [1, pageCount]', () => {
      expect(() => validateManifest(withOverrides({ '0000': { widths: [512] } }))).toThrow(/outside \[1, 3\]/);
      expect(() => validateManifest(withOverrides({ '0099': { widths: [512] } }))).toThrow(/outside \[1, 3\]/);
    });

    it('rejects override.widths violating the same rule as defaults.widths (empty, duplicate, non-positive)', () => {
      expect(() => validateManifest(withOverrides({ '0001': { widths: [] } }))).toThrow(/non-empty array/);
      expect(() => validateManifest(withOverrides({ '0001': { widths: [512, 512] } }))).toThrow(/sorted strictly ascending/);
      expect(() => validateManifest(withOverrides({ '0001': { widths: [-1] } }))).toThrow(/positive integer/);
    });

    it('rejects override.tierUrls values that fail Part 1', () => {
      expect(() => validateManifest(withOverrides({
        '0001': { tierUrls: { '8192': 'https://evil.com/x.webp' } },
      }))).toThrow(/scheme-prefixed URL/);
    });
  });
});
