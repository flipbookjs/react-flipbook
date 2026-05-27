// @vitest-environment node
//
// Decision 19 SSR safety smoke. The `@vitest-environment node` directive above
// is LOAD-BEARING — without it, the project's default jsdom env applies, which
// provides `window`/`document` globally and silently masks every Decision 19
// §1-3 violation (top-level DOM access, top-level rAF).
//
// This is a Node server-render smoke test for module-load and render-time
// safety. It is NOT a full Next.js App Router fixture — App-Router-specific
// behaviors (hydration timing, RSC payload generation, streaming SSR, Suspense
// boundary client/server transitions) are out of scope for v0.1.
//
// What this DOES verify:
//  - Importing the public API in Node doesn't throw at module load.
//    (Catches §1: top-level DOM access; §2: top-level rAF; §3: redundant
//    'use client' directives in non-client paths if any cause load-time errors.)
//  - renderToString of <Flipbook enablePageCurl /> doesn't throw.
//  - SSR output is the placeholder (curl overlay absent, per Decision 19 §4).
//  - renderPage is NOT called server-side (stub throws if it is).
//
// What this does NOT verify:
//  - Hydration correctness (no jsdom + react-dom/client in this test).
//  - Streaming SSR or Suspense boundary timing under real Next.js App Router.
//  - RSC payload generation or client-component boundary propagation.
// If a real Next.js consumer reports breakage along those axes, slot a full
// App Router fixture in then — out of scope for v0.1 per §3 Assumptions.

import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { PageSource } from '../index';

// pdfjs-dist references `DOMMatrix` at module top-level (pdf.js/src/display/canvas.js).
// In real Next.js App Router, the 'use client' directive on Flipbook.tsx prevents
// pdfjs-dist from loading server-side at all — App Router treats the entire Flipbook
// tree as a client component, and pdfjs-dist is never reached during SSR. The Node
// renderToString call in this test has no client boundary (it's the gap the plan's
// §3 Assumptions table names as "RSC client-component boundary propagation"), so it
// transitively loads pdfjs-dist and fails on DOMMatrix.
//
// Mocking pdfjs-dist here narrows the test to what 3C actually cares about: Decision
// 19 §1-3 violations in CURL FILES. pdfjs-dist's separate SSR issue is a third-party
// concern outside curl's scope — protected in real App Router consumption by the
// 'use client' boundary, irrelevant to this Node smoke. See Appendix B for the
// architectural-plan-vs-implementation discrepancy notes.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
  version: '0.0.0',
}));

function makeStubSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 6,
    getPageSize: () => ({ width: 600, height: 800 }),
    // Server-side, renderPage MUST NOT be called — isReady is false because
    // containerWidth is 0 (no ResizeObserver), so no PageRenderer mounts.
    // Throwing here makes any future regression (renderPage reached on server)
    // a loud, immediate test failure rather than a silent null-handed-back.
    renderPage: () => {
      throw new Error('renderPage must not be called during SSR');
    },
    dispose: () => {},
  };
}

describe('SSR safety (Decision 19)', () => {
  it('runs in Node, not jsdom (env directive is in effect)', () => {
    // @vitest-environment node at the top of this file is LOAD-BEARING.
    // If a future vitest config change re-enables jsdom globally (e.g.,
    // `environment: 'jsdom'`, an `environmentMatchGlobs` rule, or a vitest
    // version upgrade with different env-directive parsing), jsdom would
    // polyfill window/document — and every Decision 19 §1-3 violation
    // would pass silently. This assertion is the permanent regression guard.
    // Two lines of cost for durable protection.
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('public API module loads in a Node environment (Decision 19 §1-3)', async () => {
    // The actual SSR-safety guarantee: importing the viewer's public API on
    // a server must not throw. If any curl file has `const x = window.foo`
    // or `const r = requestAnimationFrame` at top level, this import throws
    // with ReferenceError because Node has no `window`/`requestAnimationFrame`.
    //
    // This is the most important test in this file. The renderToString tests
    // below are downstream of this — if this fails, those would too, but the
    // error message here pinpoints the load-time guarantee precisely.
    await expect(import('../index')).resolves.toBeDefined();
  });

  it('renderToString does not throw with enablePageCurl=true', async () => {
    const { Flipbook } = await import('../index');
    expect(() =>
      renderToString(<Flipbook source={makeStubSource()} enablePageCurl />),
    ).not.toThrow();
  });

  it('renderToString does not throw with enablePageCurl=false (default)', async () => {
    const { Flipbook } = await import('../index');
    expect(() =>
      renderToString(<Flipbook source={makeStubSource()} />),
    ).not.toThrow();
  });

  it('SSR output contains no curl overlay element (Decision 19 §4)', async () => {
    const { Flipbook } = await import('../index');
    const html = renderToString(<Flipbook source={makeStubSource()} enablePageCurl />);
    // Decision 19 §4: SSR-render produces a placeholder div. containerWidth is 0
    // on the server (no ResizeObserver), so the !isReady branch renders.
    // The curl overlay has className 'fbjs-curl-overlay' — it must be absent.
    expect(html).not.toContain('fbjs-curl-overlay');
  });

  it('SSR output contains the stable container class', async () => {
    // Sanity check — confirms the placeholder DID render. If renderToString
    // silently produced an empty string, the previous "not.toContain" would
    // also pass vacuously. This test guards against that false-positive shape.
    const { Flipbook } = await import('../index');
    const html = renderToString(<Flipbook source={makeStubSource()} enablePageCurl />);
    expect(html).toContain('fbjs-container');
  });
});
