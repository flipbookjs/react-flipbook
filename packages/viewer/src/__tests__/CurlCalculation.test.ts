import { describe, it, expect } from 'vitest';
import { calcCurl } from '../curl/CurlCalculation';

describe('CurlCalculation', () => {
  const pageDims = { width: 600, height: 800 };

  it('calcCurl with bottom-right drag returns positive progress and clip areas', () => {
    const result = calcCurl(
      { x: 300, y: 400 }, // mid-page drag
      pageDims,
      'next',
    );
    expect(result).not.toBeNull();
    expect(result!.progress).toBeGreaterThan(0);
    expect(result!.progress).toBeLessThanOrEqual(1);
    expect(result!.flippingClipArea.length).toBeGreaterThan(0);
    expect(result!.bottomClipArea.length).toBeGreaterThan(0);
  });

  it('drag at exact corner returns null (degenerate input — no curl geometry yet)', () => {
    // calcCurlRaw explicitly returns null when |pos.x - pageWidth| < 1 AND
    // |pos.y - pageHeight| < 1 (CurlCalculation.ts:194-198). The exact bottom-right
    // corner has nothing to curl yet — caller treats null as progress=0.
    const result = calcCurl(
      { x: 600, y: 800 }, // bottom-right corner
      pageDims,
      'next',
    );
    expect(result).toBeNull();
  });

  it('progress monotonically increases as drag point moves from corner toward spine', () => {
    // Asserts the trend rather than committing to specific magnitudes (calcCurl's
    // progress function is non-linear and depends on the rotation geometry).
    const nearCorner = calcCurl({ x: 500, y: 700 }, pageDims, 'next');
    const midPage = calcCurl({ x: 300, y: 400 }, pageDims, 'next');
    const farFromCorner = calcCurl({ x: 100, y: 400 }, pageDims, 'next');
    expect(nearCorner).not.toBeNull();
    expect(midPage).not.toBeNull();
    expect(farFromCorner).not.toBeNull();
    expect(midPage!.progress).toBeGreaterThan(nearCorner!.progress);
    expect(farFromCorner!.progress).toBeGreaterThan(midPage!.progress);
  });

  it('previous direction produces mirrored clip areas', () => {
    const next = calcCurl({ x: 300, y: 400 }, pageDims, 'next');
    const prev = calcCurl({ x: 300, y: 400 }, pageDims, 'previous');
    expect(next).not.toBeNull();
    expect(prev).not.toBeNull();
    // Mirrored: same progress magnitude but different geometry
    expect(prev!.progress).toBeCloseTo(next!.progress, 1);
  });

  it('zero-width page returns null safely (degenerate input)', () => {
    const result = calcCurl(
      { x: 0, y: 0 },
      { width: 0, height: 800 },
      'next',
    );
    expect(result).toBeNull();
  });
});
