import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFlipbookSource } from '../createFlipbookSource';
import type { FlipbookDocument, FlipbookDocumentStatus } from '../FlipbookDocument';

// Hoisted alongside vi.mock so the factory below can reference the spies.
// Without vi.hoisted, these consts sit in TDZ when the mock factory runs.
const { PdfjsSourceCtor, PreRenderedPageSourceCtor } = vi.hoisted(() => ({
  PdfjsSourceCtor: vi.fn(),
  PreRenderedPageSourceCtor: vi.fn(),
}));

// Mock implementations use regular `function` (not arrow) so the wrapped
// impl has [[Construct]] semantics — the helper invokes these via
// `new PdfjsSource(...)` / `new PreRenderedPageSource(...)`, which fails
// with "is not a constructor" against arrow-function implementations in
// Vitest 4.x. This is a plan deviation from §9's arrow-form mock factory,
// approved during Step 9 implementation as a JS-level compatibility fix.
vi.mock('@flipbookjs/react-viewer', () => ({
  PdfjsSource: vi.fn(function (...args: unknown[]) { PdfjsSourceCtor(...args); return { _ctor: 'pdfjs' }; }),
}));
vi.mock('../PreRenderedPageSource', () => ({
  PreRenderedPageSource: vi.fn(function (...args: unknown[]) { PreRenderedPageSourceCtor(...args); return { _ctor: 'pre-rendered' }; }),
}));

const baseDoc: FlipbookDocument = {
  id: 'doc_test_1', teamId: 'team_test', title: 'Test',
  sourcePdfUrl: 'https://cdn.example.com/test.pdf',
  status: 'uploaded',
};
function withStatus(s: FlipbookDocumentStatus, extras: Partial<FlipbookDocument> = {})
  : FlipbookDocument { return { ...baseDoc, status: s, ...extras }; }

beforeEach(() => {
  PdfjsSourceCtor.mockClear();
  PreRenderedPageSourceCtor.mockClear();
  vi.stubEnv('NODE_ENV', 'development');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();  // Restores any vi.stubGlobal() calls (used by Test 16).
  vi.restoreAllMocks();
});

describe('createFlipbookSource', () => {
  it("1. status='ready' with bundle URL → PreRenderedPageSource", () => {
    const doc = withStatus('ready', { artifactManifestUrl: 'https://cdn.example.com/bundle' });
    createFlipbookSource(doc);
    expect(PreRenderedPageSourceCtor).toHaveBeenCalledTimes(1);
    expect(PreRenderedPageSourceCtor).toHaveBeenCalledWith({
      bundleUrl: 'https://cdn.example.com/bundle',
      credentials: undefined,
    });
    expect(PdfjsSourceCtor).not.toHaveBeenCalled();
  });

  it("2. status='stale' with bundle URL → PreRenderedPageSource", () => {
    const doc = withStatus('stale', { artifactManifestUrl: 'https://cdn.example.com/bundle' });
    createFlipbookSource(doc);
    expect(PreRenderedPageSourceCtor).toHaveBeenCalledTimes(1);
    expect(PreRenderedPageSourceCtor).toHaveBeenCalledWith({
      bundleUrl: 'https://cdn.example.com/bundle',
      credentials: undefined,
    });
    expect(PdfjsSourceCtor).not.toHaveBeenCalled();
  });

  it("3. status='uploaded' → PdfjsSource", () => {
    const doc = withStatus('uploaded');
    createFlipbookSource(doc);
    expect(PdfjsSourceCtor).toHaveBeenCalledTimes(1);
    expect(PdfjsSourceCtor).toHaveBeenCalledWith(doc.sourcePdfUrl, undefined);
    expect(PreRenderedPageSourceCtor).not.toHaveBeenCalled();
  });

  it("4. status='converting' → PdfjsSource", () => {
    const doc = withStatus('converting');
    createFlipbookSource(doc);
    expect(PdfjsSourceCtor).toHaveBeenCalledTimes(1);
    expect(PdfjsSourceCtor).toHaveBeenCalledWith(doc.sourcePdfUrl, undefined);
    expect(PreRenderedPageSourceCtor).not.toHaveBeenCalled();
  });

  it("5. status='failed' → PdfjsSource", () => {
    const doc = withStatus('failed');
    createFlipbookSource(doc);
    expect(PdfjsSourceCtor).toHaveBeenCalledTimes(1);
    expect(PdfjsSourceCtor).toHaveBeenCalledWith(doc.sourcePdfUrl, undefined);
    expect(PreRenderedPageSourceCtor).not.toHaveBeenCalled();
  });

  it("6. status='ready' but artifactManifestUrl missing → PdfjsSource + dev warn", () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = withStatus('ready');
    createFlipbookSource(doc);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('shape drift');
    expect(message).toContain(doc.id);
    expect(PdfjsSourceCtor).toHaveBeenCalledTimes(1);
  });

  it('7. status is unrecognised → PdfjsSource + dev warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = withStatus('archived' as FlipbookDocumentStatus);
    createFlipbookSource(doc);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('unknown FlipbookDocument.status');
    expect(message).toContain("'archived'");
    expect(message).toContain(doc.id);
    expect(PdfjsSourceCtor).toHaveBeenCalledTimes(1);
  });

  it('8. does NOT warn in production, on either defensive branch', () => {
    // Override beforeEach's NODE_ENV='development' stub with 'production'.
    vi.stubEnv('NODE_ENV', 'production');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Ready-without-URL branch.
    createFlipbookSource(withStatus('ready'));
    // Unknown-status branch.
    createFlipbookSource(withStatus('archived' as FlipbookDocumentStatus));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('9. credentials threaded to PreRenderedPageSource', () => {
    const doc = withStatus('ready', { artifactManifestUrl: 'https://cdn.example.com/bundle' });
    createFlipbookSource(doc, { credentials: 'include' });
    expect(PreRenderedPageSourceCtor).toHaveBeenCalledWith({
      bundleUrl: 'https://cdn.example.com/bundle',
      credentials: 'include',
    });
  });

  it('10. pdfjs options threaded to PdfjsSource', () => {
    const doc = withStatus('uploaded');
    createFlipbookSource(doc, { pdfjs: { workerSrc: '/worker.js', password: 'x' } });
    expect(PdfjsSourceCtor).toHaveBeenCalledWith(doc.sourcePdfUrl, { workerSrc: '/worker.js', password: 'x' });
  });

  it('11. _meta field is opaque on PdfjsSource branch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = withStatus('uploaded', { _meta: { tier: 'cold', custom: { nested: true } } });
    createFlipbookSource(doc);
    expect(PdfjsSourceCtor).toHaveBeenCalledTimes(1);
    // No _meta leak — PdfjsSource receives (url, undefined), not the whole doc or _meta.
    expect(PdfjsSourceCtor).toHaveBeenCalledWith(doc.sourcePdfUrl, undefined);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('12. _meta field is opaque on PreRenderedPageSource branch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = withStatus('ready', {
      artifactManifestUrl: 'https://cdn.example.com/bundle',
      _meta: { tier: 'warm' },
    });
    createFlipbookSource(doc);
    expect(PreRenderedPageSourceCtor).toHaveBeenCalledTimes(1);
    // No _meta leak — PreRenderedPageSource receives exactly the documented options only.
    expect(PreRenderedPageSourceCtor).toHaveBeenCalledWith({
      bundleUrl: 'https://cdn.example.com/bundle',
      credentials: undefined,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('13. pdfjs options do NOT leak to PreRenderedPageSource branch', () => {
    const doc = withStatus('ready', { artifactManifestUrl: 'https://cdn.example.com/bundle' });
    createFlipbookSource(doc, { pdfjs: { workerSrc: '/w.js' } });
    // Only bundleUrl + credentials should reach PreRenderedPageSource — no pdfjs field.
    expect(PreRenderedPageSourceCtor).toHaveBeenCalledWith({
      bundleUrl: 'https://cdn.example.com/bundle',
      credentials: undefined,
    });
  });

  it('14. credentials does NOT leak to PdfjsSource branch', () => {
    const doc = withStatus('uploaded');
    createFlipbookSource(doc, { credentials: 'include' });
    // PdfjsSource takes (url, options.pdfjs) — options.credentials should be absent.
    expect(PdfjsSourceCtor).toHaveBeenCalledWith(doc.sourcePdfUrl, undefined);
  });

  it('15. redundant options on the wrong branch are silently ignored', () => {
    const doc = withStatus('uploaded');
    createFlipbookSource(doc, { credentials: 'include', pdfjs: { workerSrc: '/w.js' } });
    // credentials is ignored (PdfjsSource branch); pdfjs.workerSrc IS forwarded.
    expect(PdfjsSourceCtor).toHaveBeenCalledWith(doc.sourcePdfUrl, { workerSrc: '/w.js' });
  });

  it('16. does NOT warn when process is undefined (bundle-less browser)', () => {
    // Simulate a bundle-less browser environment where `process` isn't polyfilled.
    // isDevMode() should return false via its `typeof process === 'undefined'` branch,
    // silencing warns on BOTH defensive branches (parallel to Test 8's production check).
    //
    // Manual save/restore instead of vi.stubGlobal('process', undefined): vitest's own
    // RPC layer holds a reference to `process` and calls `process.nextTick` internally.
    // vi.unstubAllGlobals in afterEach restores AFTER the test body ends, but vitest
    // may attempt RPC calls between the test body and afterEach — those hit
    // `undefined.nextTick` and crash the worker. Try/finally with an inline restore
    // guarantees `process` is restored BEFORE any post-test RPC has a chance to run.
    const globalObj = globalThis as unknown as { process: unknown };
    const originalProcess = globalObj.process;
    globalObj.process = undefined;
    try {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      createFlipbookSource(withStatus('ready'));
      createFlipbookSource(withStatus('archived' as FlipbookDocumentStatus));
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      globalObj.process = originalProcess;
    }
  });
});
