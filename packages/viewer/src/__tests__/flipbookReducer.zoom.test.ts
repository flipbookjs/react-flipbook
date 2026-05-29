import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  flipbookReducer,
  createInitialState,
  clampCustomScale,
  resolveDefaultScale,
  type FlipbookAction,
} from '../core/flipbookReducer';
import { MIN_SCALE, MAX_SCALE } from '../zoom/zoomingLevel';
import { SpecialZoomLevel } from '../zoom/SpecialZoomLevel';

// Silence intentional dev-mode console.warn from clampCustomScale, resolveDefaultScale,
// the SET_ZOOM(custom, no-arg|NaN) reducer branch, and createInitialState w/ out-of-range
// defaultScale. Without this spy, ~11 warns fire across this file's tests, polluting
// stderr (Finding 1 from template-10 external-dependency review). Pattern matches
// existing project convention at CurlChunkErrorBoundary.test.tsx:25 + CurlOverlay.test.tsx:155.
//
// File-level scope is acceptable here because every test in this file exercises zoom code
// paths only — there's no foreign code that might emit unintended warns we'd want to see.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// M1 fix from template-1 review: restore mocks after each test so the beforeEach spy
// (and any per-test spies) get torn down even if an assertion throws mid-test. Matches
// existing project convention at useCurlMode.test.tsx:71 + useCurlRenderCallback.test.tsx:132.
afterEach(() => {
  vi.restoreAllMocks();
});

describe('clampCustomScale', () => {
  it('passes through in-range values', () => {
    expect(clampCustomScale(1)).toBe(1);
    expect(clampCustomScale(MIN_SCALE)).toBe(MIN_SCALE);
    expect(clampCustomScale(MAX_SCALE)).toBe(MAX_SCALE);
    expect(clampCustomScale(2.5)).toBe(2.5);
  });

  it('clamps values below MIN_SCALE up to MIN_SCALE', () => {
    expect(clampCustomScale(0)).toBe(MIN_SCALE);
    expect(clampCustomScale(-1)).toBe(MIN_SCALE);
    expect(clampCustomScale(0.05)).toBe(MIN_SCALE);
  });

  it('clamps values above MAX_SCALE down to MAX_SCALE (including +Infinity)', () => {
    expect(clampCustomScale(5)).toBe(MAX_SCALE);
    expect(clampCustomScale(50)).toBe(MAX_SCALE);
    expect(clampCustomScale(Infinity)).toBe(MAX_SCALE);
  });

  it('clamps -Infinity to MIN_SCALE', () => {
    expect(clampCustomScale(-Infinity)).toBe(MIN_SCALE);
  });

  it('returns 1 for NaN (genuinely invalid; no clamp direction)', () => {
    expect(clampCustomScale(NaN)).toBe(1);
  });
});

describe('resolveDefaultScale', () => {
  it("'fit-page' produces fit-page mode with customScale=1", () => {
    expect(resolveDefaultScale('fit-page')).toEqual({ zoomMode: 'fit-page', customScale: 1 });
  });

  it("'fit-width' produces fit-width mode with customScale=1", () => {
    expect(resolveDefaultScale('fit-width')).toEqual({ zoomMode: 'fit-width', customScale: 1 });
  });

  it("'ActualSize' produces custom mode with customScale=1", () => {
    expect(resolveDefaultScale('ActualSize')).toEqual({ zoomMode: 'custom', customScale: 1 });
  });

  it('numeric input produces custom mode with clamped customScale', () => {
    expect(resolveDefaultScale(1.5)).toEqual({ zoomMode: 'custom', customScale: 1.5 });
    expect(resolveDefaultScale(50)).toEqual({ zoomMode: 'custom', customScale: MAX_SCALE });
    expect(resolveDefaultScale(0)).toEqual({ zoomMode: 'custom', customScale: MIN_SCALE });
  });
});

describe('createInitialState — zoom fields', () => {
  it('defaults to fit-page mode + customScale=1 when no defaultScale passed', () => {
    const state = createInitialState();
    expect(state.zoomMode).toBe('fit-page');
    expect(state.customScale).toBe(1);
  });

  it('honors explicit defaultScale="fit-width"', () => {
    const state = createInitialState('auto', 'fit-width');
    expect(state.zoomMode).toBe('fit-width');
    expect(state.customScale).toBe(1);
  });

  it('honors explicit numeric defaultScale (clamped at factory boundary)', () => {
    const state = createInitialState('auto', 1.5);
    expect(state.zoomMode).toBe('custom');
    expect(state.customScale).toBe(1.5);
  });

  it('clamps out-of-range defaultScale at factory boundary (prevents multi-GB initial canvas)', () => {
    const state = createInitialState('auto', 50);
    expect(state.zoomMode).toBe('custom');
    expect(state.customScale).toBe(MAX_SCALE);
  });
});

// F7 — verify SpecialZoomLevel enum values pass through createInitialState
// without TypeScript casts. This is the load-bearing CMS-migration claim from
// Decision 5: CMS code passing `defaultScale={SpecialZoomLevel.PageFit}` must
// typecheck AND resolve to the right (zoomMode, customScale) pair at runtime.
// If TypeScript flags any of these as not-assignable, the enum's claimed
// ergonomic-compatibility benefit is broken at the type level.
describe('SpecialZoomLevel as defaultScale argument', () => {
  it('SpecialZoomLevel.PageFit resolves to fit-page mode', () => {
    const state = createInitialState('auto', SpecialZoomLevel.PageFit);
    expect(state.zoomMode).toBe('fit-page');
    expect(state.customScale).toBe(1);
  });

  it('SpecialZoomLevel.PageWidth resolves to fit-width mode', () => {
    const state = createInitialState('auto', SpecialZoomLevel.PageWidth);
    expect(state.zoomMode).toBe('fit-width');
    expect(state.customScale).toBe(1);
  });

  it('SpecialZoomLevel.ActualSize resolves to custom mode + customScale=1', () => {
    const state = createInitialState('auto', SpecialZoomLevel.ActualSize);
    expect(state.zoomMode).toBe('custom');
    expect(state.customScale).toBe(1);
  });
});

describe('flipbookReducer — SET_ZOOM', () => {
  const base = createInitialState();

  it('switches to fit-width mode, preserves customScale', () => {
    const action: FlipbookAction = { type: 'SET_ZOOM', mode: 'fit-width' };
    const next = flipbookReducer(base, action);
    expect(next.zoomMode).toBe('fit-width');
    expect(next.customScale).toBe(1); // unchanged
  });

  it('switches to custom mode with an in-range customScale (no clamping needed)', () => {
    const action: FlipbookAction = { type: 'SET_ZOOM', mode: 'custom', customScale: 2.5 };
    const next = flipbookReducer(base, action);
    expect(next.zoomMode).toBe('custom');
    expect(next.customScale).toBe(2.5);
  });

  it('clamps custom mode values at reducer boundary (defense in depth with factory)', () => {
    const action: FlipbookAction = { type: 'SET_ZOOM', mode: 'custom', customScale: 50 };
    const next = flipbookReducer(base, action);
    expect(next.customScale).toBe(MAX_SCALE);
  });

  it('ignores SET_ZOOM(custom) without a customScale arg in production-equivalent path', () => {
    // File-level beforeEach silences the dev-mode warn (template-10 fix).
    const action = { type: 'SET_ZOOM', mode: 'custom' } as unknown as FlipbookAction;
    const next = flipbookReducer(base, action);
    expect(next).toBe(base); // same reference — action ignored
  });

  it('ignores SET_ZOOM(custom) with NaN customScale', () => {
    const action: FlipbookAction = { type: 'SET_ZOOM', mode: 'custom', customScale: NaN };
    const next = flipbookReducer(base, action);
    expect(next).toBe(base);
  });

  it('same-value short-circuit prevents spurious re-render at the cap', () => {
    const atCap = flipbookReducer(base, { type: 'SET_ZOOM', mode: 'custom', customScale: MAX_SCALE });
    const stillAtCap = flipbookReducer(atCap, { type: 'SET_ZOOM', mode: 'custom', customScale: MAX_SCALE });
    expect(stillAtCap).toBe(atCap); // same reference — short-circuit fired
  });

  it('preserves customScale across mode toggle: fit-page → custom(1.5) → fit-width → custom(restore)', () => {
    let s = base;
    expect(s).toMatchObject({ zoomMode: 'fit-page', customScale: 1 });

    // Switch to custom 1.5
    s = flipbookReducer(s, { type: 'SET_ZOOM', mode: 'custom', customScale: 1.5 });
    expect(s).toMatchObject({ zoomMode: 'custom', customScale: 1.5 });

    // Switch to fit-width — customScale stays 1.5 (preserved field)
    s = flipbookReducer(s, { type: 'SET_ZOOM', mode: 'fit-width' });
    expect(s).toMatchObject({ zoomMode: 'fit-width', customScale: 1.5 });

    // Consumer can restore to custom by re-passing state.customScale (which still holds 1.5).
    s = flipbookReducer(s, { type: 'SET_ZOOM', mode: 'custom', customScale: s.customScale });
    expect(s).toMatchObject({ zoomMode: 'custom', customScale: 1.5 });
  });

  it('no-op when SET_ZOOM(fit-page) dispatched on state already in fit-page', () => {
    const s = flipbookReducer(base, { type: 'SET_ZOOM', mode: 'fit-page' });
    expect(s).toBe(base);
  });

  it('SOURCE_CHANGED preserves zoomMode + customScale across source swap (F3 contract)', () => {
    // Set custom zoom, then simulate source change. zoom state should survive.
    const zoomed = flipbookReducer(base, { type: 'SET_ZOOM', mode: 'custom', customScale: 1.5 });
    expect(zoomed).toMatchObject({ zoomMode: 'custom', customScale: 1.5 });

    const afterSourceChange = flipbookReducer(zoomed, {
      type: 'SOURCE_CHANGED',
      pageCount: 20,
    });

    // pageCount + currentSpreadIndex updated; zoom fields preserved.
    expect(afterSourceChange.pageCount).toBe(20);
    expect(afterSourceChange.zoomMode).toBe('custom');
    expect(afterSourceChange.customScale).toBe(1.5);
  });

  it('SET_ZOOM with mode=fit-width and a customScale arg silently ignores the arg (T8-1 — Decision 4 contract)', () => {
    // Decision 4: "'fit-page' or 'fit-width': set zoomMode; ignore customScale
    // arg (keep existing)." The reducer's fit-page/fit-width branch returns
    // { ...state, zoomMode: action.mode } without reading action.customScale.
    // This test guards against a future refactor that mistakenly mutates
    // state.customScale when a non-custom-mode action carries a customScale.
    const zoomed = flipbookReducer(base, { type: 'SET_ZOOM', mode: 'custom', customScale: 1.5 });
    expect(zoomed.customScale).toBe(1.5);

    // Dispatch fit-width WITH a customScale arg — should be ignored.
    const afterIgnoredArg = flipbookReducer(zoomed, {
      type: 'SET_ZOOM',
      mode: 'fit-width',
      customScale: 99,
    } as FlipbookAction);

    expect(afterIgnoredArg.zoomMode).toBe('fit-width');
    expect(afterIgnoredArg.customScale).toBe(1.5);   // STILL 1.5 — the 99 was ignored, prior value preserved
  });

  it('SET_VIEW_MODE preserves zoomMode + customScale (T7-1 — Decision 13 orthogonality)', () => {
    // Architectural plan Decision 13: zoom + view-mode are orthogonal — no auto-coupling.
    // SET_VIEW_MODE's existing Step 2 reducer case spreads ...state and overrides only
    // view-mode-related fields. This test guards against a future refactor that might
    // accidentally manipulate zoom state inside SET_VIEW_MODE's handler.
    const zoomedSingle = flipbookReducer(
      { ...base, viewMode: 'single', resolvedViewMode: 'single' },
      { type: 'SET_ZOOM', mode: 'custom', customScale: 2 },
    );
    expect(zoomedSingle).toMatchObject({ zoomMode: 'custom', customScale: 2 });

    const afterViewModeChange = flipbookReducer(zoomedSingle, {
      type: 'SET_VIEW_MODE',
      mode: 'dual-cover',
    });

    // viewMode + resolvedViewMode updated; zoom fields preserved (orthogonality).
    expect(afterViewModeChange.viewMode).toBe('dual-cover');
    expect(afterViewModeChange.zoomMode).toBe('custom');
    expect(afterViewModeChange.customScale).toBe(2);
  });
});
