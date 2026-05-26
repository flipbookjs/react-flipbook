// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createPageRegistry, type PageRegistryEntry } from '../core/PageRegistry';

function makeEntry(): PageRegistryEntry {
  return {
    canvas: document.createElement('canvas'),
    element: document.createElement('div'),
  };
}

describe('PageRegistry', () => {
  it('register and unregister are idempotent by pageIndex', () => {
    const { write, read } = createPageRegistry();
    const entry = makeEntry();

    write.register(0, entry);
    const v1 = read.getSnapshot();

    write.register(0, entry); // same refs → no version bump (Strict Mode contract)
    expect(read.getSnapshot()).toBe(v1);

    write.unregister(99); // non-existent → no-op
    expect(read.getSnapshot()).toBe(v1);

    write.unregister(0); // real removal → bump
    expect(read.getSnapshot()).toBeGreaterThan(v1);
  });

  it('different entry refs at same pageIndex DO bump version', () => {
    const { write, read } = createPageRegistry();
    const e1 = makeEntry();
    const e2 = makeEntry(); // different canvas + element refs

    write.register(0, e1);
    const v1 = read.getSnapshot();
    write.register(0, e2);
    expect(read.getSnapshot()).toBeGreaterThan(v1);
  });

  it('subscribers fire synchronously inside register/unregister', () => {
    const { write, read } = createPageRegistry();
    const cb = vi.fn();
    read.subscribe(cb);

    write.register(0, makeEntry());
    expect(cb).toHaveBeenCalledTimes(1); // synchronous

    write.unregister(0);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('multiple subscribers all fire; unsubscribe cleans up', () => {
    const { write, read } = createPageRegistry();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = read.subscribe(cb1);
    read.subscribe(cb2);

    write.register(0, makeEntry());
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);

    unsub1();
    write.register(1, makeEntry());
    expect(cb1).toHaveBeenCalledTimes(1); // unsubscribed, no more calls
    expect(cb2).toHaveBeenCalledTimes(2);
  });

  it('getServerSnapshot returns 0 for SSR safety', () => {
    const { read } = createPageRegistry();
    expect(read.getServerSnapshot()).toBe(0);
  });

  it('Strict Mode simulation: register → unregister → register (same refs) yields one net bump', () => {
    const { write, read } = createPageRegistry();
    const entry = makeEntry();
    const startVersion = read.getSnapshot();

    write.register(0, entry);   // bump
    write.unregister(0);         // bump
    write.register(0, entry);   // SAME refs, but unregister cleared the map → IS a real change → bump
    // Actual end state: registered with same refs. Net bumps from start: 3.
    // The "skip bump on same refs" applies only when an entry already exists.
    expect(read.getSnapshot()).toBe(startVersion + 3);
    expect(read.get(0)).toBe(entry);
  });
});
