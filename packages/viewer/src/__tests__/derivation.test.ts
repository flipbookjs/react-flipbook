import { describe, it, expect } from 'vitest';
import { deriveEffectiveScaleAndOverflow, type DeriveInputs } from '../zoom/derivation';

// Base inputs for a typical dual-cover desktop scenario: 1200×800 spread in a
// 1280×900 container. Tests override only the field they're exercising.
const base: DeriveInputs = {
  zoomMode: 'fit-page',
  customScale: 1,
  resolvedViewMode: 'dual-cover',
  containerWidth: 1280,
  containerHeight: 900,
  pageWidth: 600,
  pageHeight: 800,
};

describe('deriveEffectiveScaleAndOverflow — fit-page branch', () => {
  it('matches Step 2 behavior: Math.min(scaleX, scaleY) with container padding', () => {
    const { effectiveScale } = deriveEffectiveScaleAndOverflow(base);
    // availableWidth = 1280 - 32 = 1248; availableHeight = 900 - 32 = 868
    // spreadWidth = 1200; spreadHeight = 800
    // scaleX = 1248/1200 = 1.04; scaleY = 868/800 = 1.085
    // effectiveScale = min(1.04, 1.085) = 1.04
    expect(effectiveScale).toBeCloseTo(1.04, 3);
  });

  it('fit-page on a small container returns the smaller dimension ratio', () => {
    const { effectiveScale } = deriveEffectiveScaleAndOverflow({ ...base, containerWidth: 600, containerHeight: 400 });
    // available 568 × 368; scaleX = 568/1200 = 0.473; scaleY = 368/800 = 0.46; min = 0.46
    expect(effectiveScale).toBeCloseTo(0.46, 3);
  });

  it('isOverflowing false in fit-page (spread fits by definition)', () => {
    const { isOverflowing } = deriveEffectiveScaleAndOverflow(base);
    expect(isOverflowing).toBe(false);
  });
});

describe('deriveEffectiveScaleAndOverflow — fit-width branch', () => {
  it('uses availableWidth / spreadWidth', () => {
    const { effectiveScale } = deriveEffectiveScaleAndOverflow({ ...base, zoomMode: 'fit-width' });
    // availableWidth = 1248; effectiveScale = 1248/1200 = 1.04
    expect(effectiveScale).toBeCloseTo(1.04, 3);
  });

  it('fit-width on a TALL container can overflow vertically', () => {
    // 600×800 page, dual-cover spread = 1200×800; container 1280×400.
    // fit-width gives scale = 1248/1200 = 1.04; scaledHeight = 800*1.04 = 832 > containerHeight 400 → overflow
    const { effectiveScale, isOverflowing } = deriveEffectiveScaleAndOverflow({
      ...base,
      zoomMode: 'fit-width',
      containerHeight: 400,
    });
    expect(effectiveScale).toBeCloseTo(1.04, 3);
    expect(isOverflowing).toBe(true);
  });
});

describe('deriveEffectiveScaleAndOverflow — custom branch', () => {
  it('returns customScale unchanged (ignores container dims)', () => {
    const { effectiveScale } = deriveEffectiveScaleAndOverflow({ ...base, zoomMode: 'custom', customScale: 1.5 });
    expect(effectiveScale).toBe(1.5);
  });

  it('custom scale > fit-page → isOverflowing true', () => {
    const { isOverflowing } = deriveEffectiveScaleAndOverflow({ ...base, zoomMode: 'custom', customScale: 2 });
    // scaledWidth = 1200*2 = 2400 > 1280 → overflow
    expect(isOverflowing).toBe(true);
  });

  it('custom scale below fit-page → isOverflowing false', () => {
    const { isOverflowing } = deriveEffectiveScaleAndOverflow({ ...base, zoomMode: 'custom', customScale: 0.5 });
    // scaledWidth = 600 < 1280, scaledHeight = 400 < 900 → no overflow
    expect(isOverflowing).toBe(false);
  });
});

describe('deriveEffectiveScaleAndOverflow — isOverflowing strict-> boundary (L1)', () => {
  it('returns isOverflowing=false at exact equality (scaledWidth === containerWidth)', () => {
    // Pick custom scale so spreadWidth*scale === containerWidth exactly.
    // spreadWidth=1200, target containerWidth=1200 → scale=1
    const { isOverflowing } = deriveEffectiveScaleAndOverflow({
      ...base,
      zoomMode: 'custom',
      customScale: 1,
      containerWidth: 1200,
      containerHeight: 800,
    });
    // scaledWidth = 1200 === containerWidth → STRICT > is false → not overflowing
    expect(isOverflowing).toBe(false);
  });

  it('returns isOverflowing=true at one pixel above equality WIDTH (catches future >= refactor regression)', () => {
    const { isOverflowing } = deriveEffectiveScaleAndOverflow({
      ...base,
      zoomMode: 'custom',
      customScale: 1,
      containerWidth: 1199,   // one less than scaledWidth=1200
      containerHeight: 800,
    });
    expect(isOverflowing).toBe(true);
  });

  it('returns isOverflowing=false at exact equality for HEIGHT (scaledHeight === containerHeight)', () => {
    // L2 fix: WIDTH boundary was tested; HEIGHT boundary equally needs coverage.
    // Symmetric formula: isOverflowing = scaledW > containerW || scaledH > containerH.
    // pageHeight=800, custom scale=1, containerHeight=800 → scaledHeight === containerHeight.
    const { isOverflowing } = deriveEffectiveScaleAndOverflow({
      ...base,
      zoomMode: 'custom',
      customScale: 1,
      containerWidth: 2000,  // wide enough to not overflow horizontally
      containerHeight: 800,
    });
    expect(isOverflowing).toBe(false);
  });

  it('returns isOverflowing=true at one pixel above equality HEIGHT (catches future >= refactor regression)', () => {
    const { isOverflowing } = deriveEffectiveScaleAndOverflow({
      ...base,
      zoomMode: 'custom',
      customScale: 1,
      containerWidth: 2000,
      containerHeight: 799,  // one less than scaledHeight=800
    });
    expect(isOverflowing).toBe(true);
  });
});

describe('deriveEffectiveScaleAndOverflow — single-mode spread width', () => {
  it('single mode: spreadWidth = pageWidth (not pageWidth*2)', () => {
    const { effectiveScale } = deriveEffectiveScaleAndOverflow({
      ...base,
      resolvedViewMode: 'single',
      zoomMode: 'fit-width',
    });
    // single spreadWidth = 600; availableWidth = 1248; scale = 1248/600 = 2.08
    expect(effectiveScale).toBeCloseTo(2.08, 3);
  });
});
