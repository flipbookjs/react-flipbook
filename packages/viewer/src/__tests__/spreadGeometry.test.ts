import { describe, it, expect } from 'vitest';
import { deriveSpreadGeometry } from '../curl/spreadGeometry';
import { computeSpreads } from '../core/computeSpreads';

describe('deriveSpreadGeometry', () => {
  it('interior dual spread in dual-cover', () => {
    // 6-page dual-cover: [null,0] [1,2] [3,4] [5,null]
    const spreads = computeSpreads(6, 'dual-cover');
    const g = deriveSpreadGeometry(spreads, 1);
    expect(g.currentPages).toEqual([1, 2]);
    expect(g.nextPages).toEqual([3, 4]);
    expect(g.previousPages).toEqual([0]);
    expect(g.currentSoloShape).toBeNull();
    expect(g.previousSoloShape).toBe('cover');
    expect(g.nextSoloShape).toBeNull();
  });

  it('cover spread at index 0', () => {
    const spreads = computeSpreads(10, 'dual-cover');
    const g = deriveSpreadGeometry(spreads, 0);
    expect(g.currentPages).toEqual([0]);
    expect(g.currentSoloShape).toBe('cover');
    expect(g.previousPages).toEqual([]);
    expect(g.previousSoloShape).toBeNull();
  });

  it('last-solo spread for even-page-count documents', () => {
    // 6 pages dual-cover → spreads [null,0] [1,2] [3,4] [5,null]
    const spreads = computeSpreads(6, 'dual-cover');
    const g = deriveSpreadGeometry(spreads, 3);
    expect(g.currentPages).toEqual([5]);
    expect(g.currentSoloShape).toBe('last-solo');
    expect(g.nextPages).toEqual([]);
  });

  it('previousSoloShape="cover" when current is interior spread at index 1', () => {
    const spreads = computeSpreads(10, 'dual-cover');
    const g = deriveSpreadGeometry(spreads, 1);
    expect(g.previousSoloShape).toBe('cover');
  });

  it('nextSoloShape="last-solo" when next is last spread of even-page doc', () => {
    const spreads = computeSpreads(6, 'dual-cover');
    const g = deriveSpreadGeometry(spreads, 2);
    expect(g.nextPages).toEqual([5]);
    expect(g.nextSoloShape).toBe('last-solo');
  });

  it('single mode: each spread has one right page; no solos', () => {
    const spreads = computeSpreads(5, 'single');
    const g = deriveSpreadGeometry(spreads, 2);
    expect(g.currentPages).toEqual([2]);
    expect(g.currentSoloShape).toBe('cover'); // {left: null, right: 2} — derives as cover
    expect(g.nextPages).toEqual([3]);
    expect(g.previousPages).toEqual([1]);
  });

  it('out-of-range currentSpreadIndex returns empty arrays', () => {
    const spreads = computeSpreads(6, 'dual-cover');
    const g = deriveSpreadGeometry(spreads, 99);
    expect(g.currentPages).toEqual([]);
    expect(g.currentSoloShape).toBeNull();
  });
});
