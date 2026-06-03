import { describe, expect, it } from 'vitest';
import { flipbookReducer, createInitialState } from '../core/flipbookReducer';
import type { FlipbookState } from '../core/flipbookReducer';

const initial = (): FlipbookState => createInitialState('auto', 'fit-page', 'light');

describe('flipbookReducer — Step 6 actions', () => {
  describe('SET_FULLSCREEN', () => {
    it('flips isFullScreen', () => {
      const s = flipbookReducer(initial(), { type: 'SET_FULLSCREEN', value: true });
      expect(s.isFullScreen).toBe(true);
    });
    it('returns same state on no-op', () => {
      const s0 = initial();
      const s1 = flipbookReducer(s0, { type: 'SET_FULLSCREEN', value: false });
      expect(s1).toBe(s0);
    });
  });

  describe('SET_THEME', () => {
    it('updates theme', () => {
      const s = flipbookReducer(initial(), { type: 'SET_THEME', value: 'dark' });
      expect(s.theme).toBe('dark');
    });
    it('returns same state on no-op', () => {
      const s0 = initial();
      const s1 = flipbookReducer(s0, { type: 'SET_THEME', value: 'light' });
      expect(s1).toBe(s0);
    });
  });

  describe('SET_INTERACTION_MODE', () => {
    it('updates interactionMode', () => {
      const s = flipbookReducer(initial(), { type: 'SET_INTERACTION_MODE', value: 'pan' });
      expect(s.interactionMode).toBe('pan');
    });
  });

  describe('SET_PRINTING', () => {
    it('flips isPrinting', () => {
      const s = flipbookReducer(initial(), { type: 'SET_PRINTING', value: true });
      expect(s.isPrinting).toBe(true);
    });
  });

  describe('SET_PRINT_ERROR', () => {
    it('sets printError with fresh identity each dispatch', () => {
      const s0 = initial();
      const payload = { type: 'too-large' as const, totalPages: 200, limit: 100 };
      const s1 = flipbookReducer(s0, { type: 'SET_PRINT_ERROR', payload });
      const s2 = flipbookReducer(s1, { type: 'SET_PRINT_ERROR', payload });
      expect(s1.printError).toEqual(payload);
      // Same VALUE, different IDENTITY — Decision 7 requirement for timer reset
      expect(s1.printError).not.toBe(s2.printError);
    });
  });

  describe('CLEAR_PRINT_ERROR', () => {
    it('clears printError', () => {
      const s0 = flipbookReducer(initial(), {
        type: 'SET_PRINT_ERROR',
        payload: { type: 'too-large', totalPages: 200, limit: 100 },
      });
      const s1 = flipbookReducer(s0, { type: 'CLEAR_PRINT_ERROR' });
      expect(s1.printError).toBeNull();
    });
    it('returns same state when already null', () => {
      const s0 = initial();
      const s1 = flipbookReducer(s0, { type: 'CLEAR_PRINT_ERROR' });
      expect(s1).toBe(s0);
    });
  });

  describe('SOURCE_CHANGED reset matrix (Decision 1)', () => {
    it('resets printError and isPrinting; KEEPS theme/interactionMode/isFullScreen', () => {
      // Set transient fields, then change source.
      let s = initial();
      s = flipbookReducer(s, { type: 'SET_THEME', value: 'dark' });
      s = flipbookReducer(s, { type: 'SET_INTERACTION_MODE', value: 'pan' });
      s = flipbookReducer(s, { type: 'SET_FULLSCREEN', value: true });
      s = flipbookReducer(s, { type: 'SET_PRINTING', value: true });
      s = flipbookReducer(s, {
        type: 'SET_PRINT_ERROR',
        payload: { type: 'too-large', totalPages: 999, limit: 100 },
      });

      const after = flipbookReducer(s, { type: 'SOURCE_CHANGED', pageCount: 10 });
      expect(after.printError).toBeNull();        // RESET
      expect(after.isPrinting).toBe(false);       // RESET
      expect(after.theme).toBe('dark');           // KEPT
      expect(after.interactionMode).toBe('pan');  // KEPT
      expect(after.isFullScreen).toBe(true);      // KEPT
    });
  });
});

describe('createInitialState — Step 6 initialTheme parameter', () => {
  it('defaults to light', () => {
    expect(createInitialState().theme).toBe('light');
    expect(createInitialState('auto').theme).toBe('light');
    expect(createInitialState('auto', 'fit-page').theme).toBe('light');
  });
  it('accepts dark', () => {
    expect(createInitialState('auto', 'fit-page', 'dark').theme).toBe('dark');
  });
  it('seeds all Step 6 fields with defaults besides theme', () => {
    const s = createInitialState('auto', 'fit-page', 'dark');
    expect(s.isFullScreen).toBe(false);
    expect(s.interactionMode).toBe('select');
    expect(s.isPrinting).toBe(false);
    expect(s.printError).toBeNull();
  });
});
