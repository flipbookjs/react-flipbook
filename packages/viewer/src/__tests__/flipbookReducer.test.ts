import { describe, it, expect } from 'vitest';
import {
  clampSpreadIndex,
  createInitialState,
  flipbookReducer,
  FlipbookState,
} from '../core/flipbookReducer';

describe('clampSpreadIndex', () => {
  it('returns 0 for (0, 0)', () => {
    expect(clampSpreadIndex(0, 0)).toBe(0);
  });

  it('returns 0 for (5, 0)', () => {
    expect(clampSpreadIndex(5, 0)).toBe(0);
  });

  it('returns 0 for (-1, 0)', () => {
    expect(clampSpreadIndex(-1, 0)).toBe(0);
  });

  it('returns 0 for (-1, 5)', () => {
    expect(clampSpreadIndex(-1, 5)).toBe(0);
  });

  it('returns 4 for (10, 5)', () => {
    expect(clampSpreadIndex(10, 5)).toBe(4);
  });

  it('returns 3 for (3, 5)', () => {
    expect(clampSpreadIndex(3, 5)).toBe(3);
  });
});

describe('createInitialState', () => {
  it('resolves auto to single', () => {
    const state = createInitialState('auto');
    expect(state.viewMode).toBe('auto');
    expect(state.resolvedViewMode).toBe('single');
  });

  it('resolves dual-cover directly', () => {
    const state = createInitialState('dual-cover');
    expect(state.viewMode).toBe('dual-cover');
    expect(state.resolvedViewMode).toBe('dual-cover');
  });

  it('resolves single directly', () => {
    const state = createInitialState('single');
    expect(state.viewMode).toBe('single');
    expect(state.resolvedViewMode).toBe('single');
  });

  it('defaults to auto when called with no arguments', () => {
    const state = createInitialState();
    expect(state.viewMode).toBe('auto');
    expect(state.resolvedViewMode).toBe('single');
  });
});

function makeState(overrides: Partial<FlipbookState> = {}): FlipbookState {
  return {
    currentSpreadIndex: 0,
    pageCount: 10,
    spreadCount: 6,
    viewMode: 'dual-cover',
    resolvedViewMode: 'dual-cover',
    containerWidth: 1024,
    containerHeight: 768,
    zoomMode: 'fit-page',
    customScale: 1,
    ...overrides,
  };
}

describe('NEXT_SPREAD / PREV_SPREAD', () => {
  it('NEXT from middle increments by 1', () => {
    const state = makeState({ currentSpreadIndex: 2 });
    const next = flipbookReducer(state, { type: 'NEXT_SPREAD' });
    expect(next.currentSpreadIndex).toBe(3);
  });

  it('NEXT at last spread stays at last', () => {
    const state = makeState({ currentSpreadIndex: 5, spreadCount: 6 });
    const next = flipbookReducer(state, { type: 'NEXT_SPREAD' });
    expect(next.currentSpreadIndex).toBe(5);
  });

  it('PREV at first spread stays at 0', () => {
    const state = makeState({ currentSpreadIndex: 0 });
    const next = flipbookReducer(state, { type: 'PREV_SPREAD' });
    expect(next.currentSpreadIndex).toBe(0);
  });

  it('NEXT/PREV with spreadCount 0 stays at 0', () => {
    const state = makeState({ currentSpreadIndex: 0, spreadCount: 0 });
    expect(flipbookReducer(state, { type: 'NEXT_SPREAD' }).currentSpreadIndex).toBe(0);
    expect(flipbookReducer(state, { type: 'PREV_SPREAD' }).currentSpreadIndex).toBe(0);
  });
});

describe('GO_TO_SPREAD', () => {
  it('valid index sets it', () => {
    const state = makeState();
    const next = flipbookReducer(state, { type: 'GO_TO_SPREAD', index: 3 });
    expect(next.currentSpreadIndex).toBe(3);
  });

  it('negative index clamps to 0', () => {
    const state = makeState();
    const next = flipbookReducer(state, { type: 'GO_TO_SPREAD', index: -5 });
    expect(next.currentSpreadIndex).toBe(0);
  });

  it('over max clamps to last', () => {
    const state = makeState({ spreadCount: 6 });
    const next = flipbookReducer(state, { type: 'GO_TO_SPREAD', index: 99 });
    expect(next.currentSpreadIndex).toBe(5);
  });

  it('spreadCount 0 stays 0', () => {
    const state = makeState({ spreadCount: 0 });
    const next = flipbookReducer(state, { type: 'GO_TO_SPREAD', index: 3 });
    expect(next.currentSpreadIndex).toBe(0);
  });
});

describe('SOURCE_CHANGED', () => {
  it('with initialSpreadIndex sets index (clamped)', () => {
    const state = makeState({ resolvedViewMode: 'dual-cover' });
    const next = flipbookReducer(state, {
      type: 'SOURCE_CHANGED',
      pageCount: 10,
      initialSpreadIndex: 3,
    });
    expect(next.pageCount).toBe(10);
    expect(next.spreadCount).toBe(6); // 1 + ceil(9/2) = 6
    expect(next.currentSpreadIndex).toBe(3);
  });

  it('without initialSpreadIndex resets to 0', () => {
    const state = makeState({ currentSpreadIndex: 4 });
    const next = flipbookReducer(state, {
      type: 'SOURCE_CHANGED',
      pageCount: 10,
    });
    expect(next.currentSpreadIndex).toBe(0);
  });

  it('initialSpreadIndex out of range is clamped', () => {
    const state = makeState({ resolvedViewMode: 'dual-cover' });
    const next = flipbookReducer(state, {
      type: 'SOURCE_CHANGED',
      pageCount: 10,
      initialSpreadIndex: 99,
    });
    expect(next.currentSpreadIndex).toBe(5); // last spread index
  });

  it('pageCount 0 gives spreadCount 0 and index 0', () => {
    const state = makeState();
    const next = flipbookReducer(state, {
      type: 'SOURCE_CHANGED',
      pageCount: 0,
    });
    expect(next.pageCount).toBe(0);
    expect(next.spreadCount).toBe(0);
    expect(next.currentSpreadIndex).toBe(0);
  });

  it('updates spreadCount correctly for both modes', () => {
    const dualState = makeState({ resolvedViewMode: 'dual-cover' });
    const dualNext = flipbookReducer(dualState, {
      type: 'SOURCE_CHANGED',
      pageCount: 11,
    });
    expect(dualNext.spreadCount).toBe(6); // 1 + ceil(10/2) = 6

    const singleState = makeState({ resolvedViewMode: 'single' });
    const singleNext = flipbookReducer(singleState, {
      type: 'SOURCE_CHANGED',
      pageCount: 11,
    });
    expect(singleNext.spreadCount).toBe(11);
  });
});

describe('CONTAINER_RESIZED', () => {
  it('updates dimensions without mode change', () => {
    const state = makeState({ viewMode: 'dual-cover', resolvedViewMode: 'dual-cover' });
    const next = flipbookReducer(state, {
      type: 'CONTAINER_RESIZED',
      width: 1200,
      height: 900,
    });
    expect(next.containerWidth).toBe(1200);
    expect(next.containerHeight).toBe(900);
    expect(next.resolvedViewMode).toBe('dual-cover');
  });

  it('auto mode crossing 768px upward switches to dual-cover', () => {
    const state = makeState({
      viewMode: 'auto',
      resolvedViewMode: 'single',
      containerWidth: 500,
      pageCount: 10,
      spreadCount: 10, // single mode: 10 spreads
      currentSpreadIndex: 0,
    });
    const next = flipbookReducer(state, {
      type: 'CONTAINER_RESIZED',
      width: 800,
      height: 600,
    });
    expect(next.resolvedViewMode).toBe('dual-cover');
    expect(next.containerWidth).toBe(800);
  });

  it('auto mode crossing 768px downward switches to single', () => {
    const state = makeState({
      viewMode: 'auto',
      resolvedViewMode: 'dual-cover',
      containerWidth: 1024,
      pageCount: 10,
      spreadCount: 6,
      currentSpreadIndex: 0,
    });
    const next = flipbookReducer(state, {
      type: 'CONTAINER_RESIZED',
      width: 500,
      height: 400,
    });
    expect(next.resolvedViewMode).toBe('single');
    expect(next.containerWidth).toBe(500);
  });

  it('explicit mode unchanged regardless of width', () => {
    const state = makeState({
      viewMode: 'single',
      resolvedViewMode: 'single',
      containerWidth: 500,
    });
    const next = flipbookReducer(state, {
      type: 'CONTAINER_RESIZED',
      width: 1200,
      height: 900,
    });
    expect(next.resolvedViewMode).toBe('single');
  });

  it('mode change preserves anchor page', () => {
    // In dual-cover with 10 pages: spread 2 = { left: 3, right: 4 }, anchor = 3
    // Switch to single: page 3 is at spread index 3
    const state = makeState({
      viewMode: 'auto',
      resolvedViewMode: 'dual-cover',
      containerWidth: 1024,
      pageCount: 10,
      spreadCount: 6,
      currentSpreadIndex: 2,
    });
    const next = flipbookReducer(state, {
      type: 'CONTAINER_RESIZED',
      width: 500,
      height: 400,
    });
    expect(next.resolvedViewMode).toBe('single');
    expect(next.currentSpreadIndex).toBe(3); // page 3 in single mode
  });
});

describe('SET_VIEW_MODE', () => {
  it('auto resolves from current containerWidth', () => {
    const state = makeState({
      viewMode: 'single',
      resolvedViewMode: 'single',
      containerWidth: 1024,
      pageCount: 10,
      spreadCount: 10,
      currentSpreadIndex: 0,
    });
    const next = flipbookReducer(state, { type: 'SET_VIEW_MODE', mode: 'auto' });
    expect(next.viewMode).toBe('auto');
    expect(next.resolvedViewMode).toBe('dual-cover'); // 1024 >= 768
  });

  it('single sets resolvedViewMode directly', () => {
    const state = makeState({
      viewMode: 'auto',
      resolvedViewMode: 'dual-cover',
      containerWidth: 1024,
      pageCount: 10,
      spreadCount: 6,
      currentSpreadIndex: 0,
    });
    const next = flipbookReducer(state, { type: 'SET_VIEW_MODE', mode: 'single' });
    expect(next.viewMode).toBe('single');
    expect(next.resolvedViewMode).toBe('single');
  });

  it('dual-cover sets resolvedViewMode directly', () => {
    const state = makeState({
      viewMode: 'single',
      resolvedViewMode: 'single',
      containerWidth: 500,
      pageCount: 10,
      spreadCount: 10,
      currentSpreadIndex: 0,
    });
    const next = flipbookReducer(state, { type: 'SET_VIEW_MODE', mode: 'dual-cover' });
    expect(next.viewMode).toBe('dual-cover');
    expect(next.resolvedViewMode).toBe('dual-cover');
  });

  it('mode change preserves anchor page', () => {
    // In dual-cover with 10 pages: spread 2 = { left: 3, right: 4 }, anchor = 3
    // Switch to single: page 3 is at spread index 3
    const state = makeState({
      viewMode: 'dual-cover',
      resolvedViewMode: 'dual-cover',
      containerWidth: 1024,
      pageCount: 10,
      spreadCount: 6,
      currentSpreadIndex: 2,
    });
    const next = flipbookReducer(state, { type: 'SET_VIEW_MODE', mode: 'single' });
    expect(next.resolvedViewMode).toBe('single');
    expect(next.currentSpreadIndex).toBe(3); // page 3 in single mode
  });

  it('same resolved mode only updates viewMode field', () => {
    // auto with containerWidth 1024 resolves to dual-cover
    // already in dual-cover — should only update viewMode
    const state = makeState({
      viewMode: 'dual-cover',
      resolvedViewMode: 'dual-cover',
      containerWidth: 1024,
      pageCount: 10,
      spreadCount: 6,
      currentSpreadIndex: 3,
    });
    const next = flipbookReducer(state, { type: 'SET_VIEW_MODE', mode: 'auto' });
    expect(next.viewMode).toBe('auto');
    expect(next.resolvedViewMode).toBe('dual-cover'); // unchanged
    expect(next.currentSpreadIndex).toBe(3); // unchanged
    expect(next.spreadCount).toBe(6); // unchanged
  });
});
