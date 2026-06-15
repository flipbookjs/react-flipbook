import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveItemDimensions, trueMedian } from '../thumbnails/resolveItemDimensions';

// Resolver-direct unit tests for the 2.0 thumbnail-sizing surface. Imports
// the resolver from the internal path (NOT via the package `index.ts` — the
// resolver is intentionally not part of the public API; only the rendered
// surface is). Same internal-import pattern as other unit tests in this
// project that exercise non-exported helpers.

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- Shared-state convention for bad-value tests ----
//
// The resolver's `warnedWidths: Set<unknown>` and `warnedDensities: Set<unknown>`
// are module-scoped and persist across `it()` blocks within this file
// (vitest's `isolate: true` clears between FILES, not between tests).
// Each bad-value test must use a value DISTINCT from values used by sibling
// tests in this file — otherwise the once-per-value dedup from one test
// silently breaks another test's warn assertion.
//
// Reserved invalid-width values:
//   NaN, Infinity, 0, -5  — used by the it.each sanitization block
//   5000, 9000            — used by the clamp test
//   -77                   — used by the once-per-session test
//
// Reserved invalid-density values:
//   'tiny', null          — used by the JS-bypass tests
//   'large'               — used by the once-per-session test
//
// Future tests that add bad-value assertions MUST pick fresh values.

// ---- §7.1 main table — density mode (uniform pages 612x792) ----
//
// Targets: { compact: 16, comfortable: 10, spacious: 6 } — calibrated for
// real PDF navigation strips (Adobe / Mozilla / Preview aesthetic, ~100-180px
// thumbs at typical desktop widths). At the test container width 1900 the
// math is meaningful for all three tokens; smaller widths exercise the
// 80 px touch-target floor.

describe('resolveItemDimensions — density mode', () => {
  const PAGE_PORTRAIT = { width: 612, height: 792 };
  const REF_WIDTH = 612;   // median for uniform-portrait documents

  it("density='compact', content 1900, gap 8 → 110", () => {
    const { width } = resolveItemDimensions('compact', undefined, PAGE_PORTRAIT, 1900, REF_WIDTH, 8);
    // (1900 - 15*8) / 16 = (1900-120)/16 = 111.25 → floor 111
    expect(width).toBe(111);
  });

  it("density='comfortable', content 1900, gap 8 → 182", () => {
    const { width } = resolveItemDimensions('comfortable', undefined, PAGE_PORTRAIT, 1900, REF_WIDTH, 8);
    // (1900 - 9*8) / 10 = (1900-72)/10 = 182.8 → floor 182
    expect(width).toBe(182);
  });

  it("density='spacious', content 1900, gap 8 → 310", () => {
    const { width } = resolveItemDimensions('spacious', undefined, PAGE_PORTRAIT, 1900, REF_WIDTH, 8);
    // (1900 - 5*8) / 6 = (1900-40)/6 = 310 → floor 310
    expect(width).toBe(310);
  });

  it("density='comfortable', narrow content 600 → clamped to 80 (floor engages)", () => {
    const { width } = resolveItemDimensions('comfortable', undefined, PAGE_PORTRAIT, 600, REF_WIDTH, 8);
    // (600 - 72) / 10 = 52.8 → clamped up to 80
    expect(width).toBe(80);
  });

  it("density='compact', extreme narrow content 320, gap 8 → clamped to 80", () => {
    const { width } = resolveItemDimensions('compact', undefined, PAGE_PORTRAIT, 320, REF_WIDTH, 8);
    // (320 - 120) / 16 = 12.5 → clamped up to 80
    expect(width).toBe(80);
  });

  it("density='spacious', content 14000 (absurd) → clamped to 2048", () => {
    const { width } = resolveItemDimensions('spacious', undefined, PAGE_PORTRAIT, 14000, REF_WIDTH, 8);
    // (14000 - 40) / 6 = 2326 → clamped down to 2048
    expect(width).toBe(2048);
  });

  it("density='comfortable', wider page than median → wider thumb", () => {
    // Mixed-orientation: same content/gap/ref as comfortable-uniform above
    // (182), but this page is 792 wide vs the 612 median. The per-page
    // scale factor produces a wider thumb.
    const wider = { width: 792, height: 612 };
    const { width } = resolveItemDimensions('comfortable', undefined, wider, 1900, REF_WIDTH, 8);
    // unitWidth=182.8 → 182.8 × (792/612) = 236.6 → floor 236
    expect(width).toBe(236);
  });

  it("density='comfortable', narrower page than median → narrower thumb", () => {
    const narrower = { width: 459, height: 612 };
    const { width } = resolveItemDimensions('comfortable', undefined, narrower, 1900, REF_WIDTH, 8);
    // 182.8 × (459/612) = 137.1 → floor 137
    expect(width).toBe(137);
  });

  it("density='comfortable' with gap=0 — regression pin for missing gap accounting", () => {
    const { width } = resolveItemDimensions('comfortable', undefined, PAGE_PORTRAIT, 1900, REF_WIDTH, 0);
    expect(width).toBe(190);   // 1900 / 10 = 190 (no gap subtraction)
  });

  it("omit both density + explicitWidth → routes to 'comfortable'", () => {
    const { width } = resolveItemDimensions(undefined, undefined, PAGE_PORTRAIT, 1900, REF_WIDTH, 8);
    // (1900 - 72) / 10 = 182.8 → floor 182
    expect(width).toBe(182);
  });

  it('per-page heights derive from each page aspect (mixed orientation)', () => {
    const portrait = { width: 612, height: 792 };
    const landscape = { width: 792, height: 612 };
    const p = resolveItemDimensions('comfortable', undefined, portrait, 1900, REF_WIDTH, 8);
    const l = resolveItemDimensions('comfortable', undefined, landscape, 1900, REF_WIDTH, 8);
    // Portrait: width 182, height = round(182 × 792/612) = 236
    expect(p.height).toBe(Math.round(182 * 792 / 612));
    // Landscape: width 236, height = round(236 × 612/792) = 182
    expect(l.height).toBe(Math.round(236 * 612 / 792));
  });
});

// ---- §7.1 explicit-width path ----

describe('resolveItemDimensions — explicit width', () => {
  const PAGE = { width: 612, height: 792 };

  it('explicitWidth=500 ignores container width', () => {
    const a = resolveItemDimensions(undefined, 500, PAGE, 800, 612, 8);
    const b = resolveItemDimensions(undefined, 500, PAGE, 1600, 612, 8);
    expect(a.width).toBe(500);
    expect(b.width).toBe(500);
  });

  it.each([NaN, Infinity, 0, -5])(
    'explicitWidth=%s (invalid) → dev-warn, falls through to comfortable density',
    (bad) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { width } = resolveItemDimensions(undefined, bad, PAGE, 1900, 612, 8);
      expect(width).toBe(182);   // comfortable default at 1900 content width
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid positive width'));
    },
  );

  it('explicitWidth=5000 (above MAX_THUMB_WIDTH) → dev-warn AND clamp to 2048', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { width } = resolveItemDimensions(undefined, 5000, PAGE, 1900, 612, 8);
    expect(width).toBe(2048);   // clamped down (NOT fall-through)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeds MAX_THUMB_WIDTH'));
  });

  it('explicitWidth=60 (below floor) → silent clamp to 80', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { width } = resolveItemDimensions(undefined, 60, PAGE, 1900, 612, 8);
    expect(width).toBe(80);
    expect(warn).not.toHaveBeenCalled();   // silent — touch-target floor
  });

  it('explicitWidth=80 (at floor) → 80', () => {
    const { width } = resolveItemDimensions(undefined, 80, PAGE, 1900, 612, 8);
    expect(width).toBe(80);
  });

  it('explicitWidth=2048 (at ceiling) → 2048', () => {
    const { width } = resolveItemDimensions(undefined, 2048, PAGE, 1900, 612, 8);
    expect(width).toBe(2048);
  });

  it('density + explicitWidth (both supplied): explicit wins', () => {
    // Note: the resolver doesn't emit a both-supplied warn — that lives at
    // the prop boundary (Flipbook / ThumbnailPanel), each surface with its
    // own message. The resolver just respects the precedence: explicit
    // width takes priority over density.
    const { width } = resolveItemDimensions('spacious', 400, PAGE, 1900, 612, 8);
    expect(width).toBe(400);
  });

  // Same bad value re-passed N times → exactly one warn. Uses a SENTINEL
  // bad value (-77) reserved exclusively for this test.
  it('same invalid width warns once per session (module-level dedup)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const SENTINEL = -77;
    resolveItemDimensions(undefined, SENTINEL, { width: 612, height: 792 }, 1900, 612, 8);
    expect(warn).toHaveBeenCalledTimes(1);
    resolveItemDimensions(undefined, SENTINEL, { width: 612, height: 792 }, 1900, 612, 8);
    expect(warn).toHaveBeenCalledTimes(1);   // still one
  });
});

// ---- §7.1 density JS-bypass sanitization ----

describe('resolveItemDimensions — density JS-side bypass', () => {
  const PAGE = { width: 612, height: 792 };

  it("density='tiny' (unknown string) → dev-warn, falls back to 'comfortable'", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Bypass TS: pass an unknown string at runtime.
    const { width } = resolveItemDimensions('tiny' as never, undefined, PAGE, 1900, 612, 8);
    expect(width).toBe(182);   // comfortable default at 1900 content width
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not one of'));
    expect(warn.mock.calls[0][0]).toContain('tiny');
  });

  it('density=null (non-string garbage) → dev-warn, falls back to comfortable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { width } = resolveItemDimensions(null as never, undefined, PAGE, 1900, 612, 8);
    expect(width).toBe(182);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not one of'));
  });

  it("density='large' bypass dedupes within session", () => {
    // 'large' was a 1.x valid token but is NOT a v2 density token.
    // The dedup means consumer ports of 1.x code that pass 'large' get
    // exactly one warn per process, not one per render.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveItemDimensions('large' as never, undefined, PAGE, 1900, 612, 8);
    expect(warn).toHaveBeenCalledTimes(1);
    resolveItemDimensions('large' as never, undefined, PAGE, 1900, 612, 8);
    expect(warn).toHaveBeenCalledTimes(1);   // still one
  });
});

// ---- §7.1 true-median helper ----

describe('trueMedian', () => {
  it('empty array → 1 (sentinel — never multiply by 0 downstream)', () => {
    expect(trueMedian([])).toBe(1);
  });

  it('single element → that element', () => {
    expect(trueMedian([612])).toBe(612);
  });

  it('two elements (even N) → average of the two', () => {
    expect(trueMedian([612, 792])).toBe(702);
  });

  it('three elements (odd N) → middle element', () => {
    expect(trueMedian([400, 500, 600])).toBe(500);
  });

  it('four elements (even N) → average of the two middles', () => {
    expect(trueMedian([100, 200, 300, 400])).toBe(250);
  });
});
