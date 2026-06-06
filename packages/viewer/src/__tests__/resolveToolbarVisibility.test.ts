import { describe, expect, it } from 'vitest';
import { resolveToolbarVisibility } from '../toolbar/resolveToolbarVisibility';

describe('resolveToolbarVisibility — default rules', () => {
  it('showPrint defaults true when consumer prop is undefined', () => {
    const r = resolveToolbarVisibility({}, { canDownload: false, canFullScreen: false, isOverflowing: false });
    expect(r.showPrint).toBe(true);
  });

  it('showDownload defaults to slice.canDownload', () => {
    expect(
      resolveToolbarVisibility({}, { canDownload: false, canFullScreen: false, isOverflowing: false }).showDownload,
    ).toBe(false);
    expect(
      resolveToolbarVisibility({}, { canDownload: true, canFullScreen: false, isOverflowing: false }).showDownload,
    ).toBe(true);
  });

  it('showFullScreen defaults to slice.canFullScreen', () => {
    expect(
      resolveToolbarVisibility({}, { canDownload: false, canFullScreen: false, isOverflowing: false }).showFullScreen,
    ).toBe(false);
    expect(
      resolveToolbarVisibility({}, { canDownload: false, canFullScreen: true, isOverflowing: false }).showFullScreen,
    ).toBe(true);
  });

  it('showSelectionMode / showZoom / showNavigation default true', () => {
    const r = resolveToolbarVisibility({}, { canDownload: false, canFullScreen: false, isOverflowing: false });
    expect(r.showSelectionMode).toBe(true);
    expect(r.showZoom).toBe(true);
    expect(r.showNavigation).toBe(true);
  });
});

describe('resolveToolbarVisibility — consumer overrides', () => {
  it('consumer true forces visible even when default would be false', () => {
    const r = resolveToolbarVisibility(
      { showDownload: true, showFullScreen: true },
      { canDownload: false, canFullScreen: false, isOverflowing: false },
    );
    expect(r.showDownload).toBe(true);
    expect(r.showFullScreen).toBe(true);
  });

  it('consumer false forces hidden even when default would be true', () => {
    const r = resolveToolbarVisibility(
      { showPrint: false, showZoom: false, showNavigation: false },
      { canDownload: true, canFullScreen: true, isOverflowing: false },
    );
    expect(r.showPrint).toBe(false);
    expect(r.showZoom).toBe(false);
    expect(r.showNavigation).toBe(false);
  });
});
