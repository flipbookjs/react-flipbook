import { describe, expect, it, vi } from 'vitest';
import { mergeRefs } from '../toolbar/mergeRefs';

describe('mergeRefs — single ref-shape paths', () => {
  it('sets RefObject .current on attach and resets on detach', () => {
    const ref = { current: null as HTMLDivElement | null };
    const merged = mergeRefs(ref);
    const node = document.createElement('div') as HTMLDivElement;
    const cleanup = merged(node);
    expect(ref.current).toBe(node);
    expect(typeof cleanup).toBe('function');
    cleanup!();
    expect(ref.current).toBeNull();
  });

  it('calls React-18-style callback ref with node on attach + null on detach', () => {
    const refFn = vi.fn();
    const merged = mergeRefs(refFn);
    const node = document.createElement('div') as HTMLDivElement;
    const cleanup = merged(node);
    expect(refFn).toHaveBeenCalledWith(node);
    cleanup!();
    expect(refFn).toHaveBeenLastCalledWith(null);
  });

  it('invokes React-19-style cleanup returned by an inner ref on unmount', () => {
    const innerCleanup = vi.fn();
    const refFn = vi.fn(() => innerCleanup);
    const merged = mergeRefs(refFn);
    const node = document.createElement('div') as HTMLDivElement;
    const cleanup = merged(node);
    expect(refFn).toHaveBeenCalledWith(node);
    expect(innerCleanup).not.toHaveBeenCalled();
    cleanup!();
    expect(innerCleanup).toHaveBeenCalledTimes(1);
  });
});

describe('mergeRefs — mixed ref-shape paths (review finding H-§1.1)', () => {
  it('mix of old-style + new-style + RefObject all detach correctly on unmount', () => {
    const oldStyle = vi.fn();
    const newStyleCleanup = vi.fn();
    const newStyle = vi.fn(() => newStyleCleanup);
    const refObj = { current: null as HTMLDivElement | null };
    const merged = mergeRefs(oldStyle, newStyle, refObj);
    const node = document.createElement('div') as HTMLDivElement;
    const cleanup = merged(node);
    // All three received the node on attach.
    expect(oldStyle).toHaveBeenCalledWith(node);
    expect(newStyle).toHaveBeenCalledWith(node);
    expect(refObj.current).toBe(node);
    expect(newStyleCleanup).not.toHaveBeenCalled();
    cleanup!();
    // All three properly detach: old-style called with null, new-style
    // cleanup invoked, RefObject reset to null.
    expect(oldStyle).toHaveBeenLastCalledWith(null);
    expect(newStyleCleanup).toHaveBeenCalledTimes(1);
    expect(refObj.current).toBeNull();
  });

  it('cleanups fire in REVERSE order (most-recently-added first)', () => {
    const order: string[] = [];
    const ref1 = vi.fn(() => () => { order.push('ref1-cleanup'); });
    const ref2 = vi.fn(() => () => { order.push('ref2-cleanup'); });
    const ref3 = vi.fn(() => () => { order.push('ref3-cleanup'); });
    const cleanup = mergeRefs(ref1, ref2, ref3)(document.createElement('div'));
    cleanup!();
    expect(order).toEqual(['ref3-cleanup', 'ref2-cleanup', 'ref1-cleanup']);
  });

  it('returning undefined cleanup from one ref does NOT block other refs from detaching', () => {
    // The bug from before the H-§1.1 fix: if one inner ref returned a cleanup
    // and another didn't, the composite would either skip the no-cleanup
    // ref's null-detach (React-19-style cleanup path) OR skip the inner
    // cleanup (React-18-style null-detach path). Verify both fire.
    const oldStyle = vi.fn();
    const newStyleCleanup = vi.fn();
    const newStyle = vi.fn(() => newStyleCleanup);
    const cleanup = mergeRefs(oldStyle, newStyle)(document.createElement('div'));
    cleanup!();
    expect(oldStyle).toHaveBeenLastCalledWith(null);
    expect(newStyleCleanup).toHaveBeenCalledTimes(1);
  });
});

describe('mergeRefs — exception isolation', () => {
  it('a throwing inner ref does NOT prevent others from being notified', () => {
    const refObj = { current: null as HTMLDivElement | null };
    const thrower = vi.fn(() => { throw new Error('inner ref boom'); });
    const errorSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const merged = mergeRefs(thrower, refObj);
    const node = document.createElement('div') as HTMLDivElement;
    expect(() => merged(node)).not.toThrow();
    expect(refObj.current).toBe(node);   // RefObject got the node despite thrower
    errorSpy.mockRestore();
  });

  it('a throwing cleanup does NOT prevent other cleanups from running', () => {
    const order: string[] = [];
    const ref1 = vi.fn(() => () => { order.push('ref1'); });
    const ref2 = vi.fn(() => () => { order.push('ref2-pre'); throw new Error('cleanup boom'); });
    const ref3 = vi.fn(() => () => { order.push('ref3'); });
    const errorSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cleanup = mergeRefs(ref1, ref2, ref3)(document.createElement('div'));
    expect(() => cleanup!()).not.toThrow();
    // Reverse order: ref3 first, ref2 (throws but caught), ref1.
    expect(order).toEqual(['ref3', 'ref2-pre', 'ref1']);
    errorSpy.mockRestore();
  });
});

describe('mergeRefs — Tab integration', () => {
  it('handles undefined refs in the input list (caller does not need to filter)', () => {
    const ref = { current: null as HTMLDivElement | null };
    const cleanup = mergeRefs(undefined, ref, undefined)(document.createElement('div'));
    expect(ref.current).not.toBeNull();
    cleanup!();
    expect(ref.current).toBeNull();
  });
});
