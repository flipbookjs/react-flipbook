import { describe, expect, it } from 'vitest';
import { flipbookReducer, createInitialState } from '../core/flipbookReducer';
import type { FlipbookState } from '../core/flipbookReducer';

function baseState(): FlipbookState {
  return createInitialState('auto', 'fit-page', 'light');
}

describe('flipbookReducer — SET_THUMBNAILS_OPEN', () => {
  it('initial state has thumbnailsOpen=false', () => {
    expect(baseState().thumbnailsOpen).toBe(false);
  });

  it('SET_THUMBNAILS_OPEN { value: true } sets the field', () => {
    const next = flipbookReducer(baseState(), { type: 'SET_THUMBNAILS_OPEN', value: true });
    expect(next.thumbnailsOpen).toBe(true);
  });

  it('SET_THUMBNAILS_OPEN { value: false } when already false returns the same state reference (idempotent)', () => {
    const s = baseState();
    const next = flipbookReducer(s, { type: 'SET_THUMBNAILS_OPEN', value: false });
    expect(next).toBe(s);
  });

  it('SET_THUMBNAILS_OPEN { value: true } when already true returns the same state reference (idempotent)', () => {
    const s = { ...baseState(), thumbnailsOpen: true };
    const next = flipbookReducer(s, { type: 'SET_THUMBNAILS_OPEN', value: true });
    expect(next).toBe(s);
  });

  it('SOURCE_CHANGED preserves thumbnailsOpen=true (NOT in the reset matrix)', () => {
    const s = { ...baseState(), thumbnailsOpen: true };
    const next = flipbookReducer(s, { type: 'SOURCE_CHANGED', pageCount: 10 });
    expect(next.thumbnailsOpen).toBe(true);
  });

  it('SOURCE_CHANGED preserves thumbnailsOpen=false', () => {
    const next = flipbookReducer(baseState(), { type: 'SOURCE_CHANGED', pageCount: 10 });
    expect(next.thumbnailsOpen).toBe(false);
  });
});
