import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Dispatch, MutableRefObject } from 'react';
import { useFullScreen } from '../hooks/useFullScreen';
import type { FlipbookAction } from '../core/flipbookReducer';

// Use writable refs so tests can mutate `.current` (e.g. install consumer
// callbacks, swap resolvers). MutableRefObject<T> is structurally assignable
// to RefObject<T>, so this type is accepted by the hook's args interface.
interface TestArgs {
  rootRef: MutableRefObject<HTMLDivElement | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  lastFocusedFullScreenButtonRef: MutableRefObject<HTMLButtonElement | null>;
  getFullScreenTargetRef: MutableRefObject<((root: HTMLElement) => HTMLElement | null | undefined) | undefined>;
  onEnterFullScreenRef: MutableRefObject<(() => void) | undefined>;
  onExitFullScreenRef: MutableRefObject<(() => void) | undefined>;
  themeRef: MutableRefObject<'light' | 'dark'>;
  theme: 'light' | 'dark';
  dispatch: Dispatch<FlipbookAction>;
}

function makeArgs(overrides: Partial<TestArgs> = {}): TestArgs {
  const rootEl = document.createElement('div');
  rootEl.className = 'fbjs-root';
  rootEl.setAttribute('data-theme', 'light');
  document.body.appendChild(rootEl);

  const containerEl = document.createElement('div');
  containerEl.className = 'fbjs-container';
  containerEl.tabIndex = 0;
  rootEl.appendChild(containerEl);

  return {
    rootRef: { current: rootEl },
    containerRef: { current: containerEl },
    lastFocusedFullScreenButtonRef: { current: null },
    getFullScreenTargetRef: { current: undefined },
    onEnterFullScreenRef: { current: undefined },
    onExitFullScreenRef: { current: undefined },
    themeRef: { current: 'light' },
    theme: 'light',
    dispatch: vi.fn(),
    ...overrides,
  };
}

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: el, writable: true });
}

const SENTINEL = Symbol('still-pending');
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const winner = await Promise.race([promise.then(() => 'resolved').catch(() => 'rejected'), Promise.resolve(SENTINEL)]);
  return winner === SENTINEL;
}

beforeEach(() => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  setFullscreenElement(null);
  HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  setFullscreenElement(null);
});

describe('useFullScreen', () => {
  // 1
  it('enterFullScreen invokes target.requestFullscreen() on the resolved target', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFullScreen(args));

    await act(async () => {
      void result.current.enterFullScreen();
    });

    const spy = HTMLElement.prototype.requestFullscreen as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(args.rootRef.current);

    // Settle the pending enter so cleanup() doesn't reject it.
    setFullscreenElement(args.rootRef.current);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
  });

  // 2
  it('fullscreenchange flips state and fires onEnterFullScreen on committed enter', async () => {
    const args = makeArgs();
    args.onEnterFullScreenRef.current = vi.fn();
    const { result } = renderHook(() => useFullScreen(args));

    await act(async () => { void result.current.enterFullScreen(); });
    setFullscreenElement(args.rootRef.current);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    expect(args.dispatch).toHaveBeenCalledWith({ type: 'SET_FULLSCREEN', value: true });
    expect(args.onEnterFullScreenRef.current).toHaveBeenCalledTimes(1);
  });

  // 3
  it('rejected requestFullscreen rolls back theme, rejects pending Promise, fires neither callback', async () => {
    const args = makeArgs();
    args.onEnterFullScreenRef.current = vi.fn();
    args.onExitFullScreenRef.current = vi.fn();
    const ancestor = document.createElement('div');
    ancestor.setAttribute('data-theme', 'brand-purple');
    document.body.appendChild(ancestor);
    args.getFullScreenTargetRef.current = () => ancestor;

    const denyError = new Error('denied');
    HTMLElement.prototype.requestFullscreen = vi.fn().mockRejectedValue(denyError);

    const { result } = renderHook(() => useFullScreen(args));
    let caught: unknown;
    await act(async () => {
      try { await result.current.enterFullScreen(); } catch (err) { caught = err; }
    });

    expect(caught).toBe(denyError);
    expect(args.dispatch).not.toHaveBeenCalled();
    expect(args.onEnterFullScreenRef.current).not.toHaveBeenCalled();
    expect(args.onExitFullScreenRef.current).not.toHaveBeenCalled();
    expect(ancestor.getAttribute('data-theme')).toBe('brand-purple');
  });

  // 4
  it('exitFullScreen invokes document.exitFullscreen() after a committed enter', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFullScreen(args));

    await act(async () => { void result.current.enterFullScreen(); });
    setFullscreenElement(args.rootRef.current);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await act(async () => { void result.current.exitFullScreen(); });
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    // Simulate browser commit so the listener resolves the pending exit
    // Promise — otherwise it's rejected on cleanup() and surfaces as unhandled.
    setFullscreenElement(null);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
  });

  // 5
  it('theme-sync updates the mirrored ancestor data-theme on theme change mid-fullscreen', async () => {
    const ancestor = document.createElement('div');
    document.body.appendChild(ancestor);

    const args = makeArgs();
    args.getFullScreenTargetRef.current = () => ancestor;

    const { result, rerender } = renderHook((props: { theme: 'light' | 'dark' }) => useFullScreen({ ...args, theme: props.theme }), {
      initialProps: { theme: 'light' },
    });

    await act(async () => { void result.current.enterFullScreen(); });
    setFullscreenElement(ancestor);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    expect(ancestor.getAttribute('data-theme')).toBe('light');

    rerender({ theme: 'dark' });
    expect(ancestor.getAttribute('data-theme')).toBe('dark');
  });

  // 6
  it('non-pure getFullScreenTarget: cleanup removes attribute from the originally-targeted element', async () => {
    const ancestorA = document.createElement('div');
    document.body.appendChild(ancestorA);
    const ancestorB = document.createElement('div');
    document.body.appendChild(ancestorB);

    const args = makeArgs();
    let callCount = 0;
    args.getFullScreenTargetRef.current = () => (callCount++ === 0 ? ancestorA : ancestorB);

    const { result } = renderHook(() => useFullScreen(args));

    await act(async () => { void result.current.enterFullScreen(); });
    setFullscreenElement(ancestorA);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(ancestorA.getAttribute('data-theme')).toBe('light');

    setFullscreenElement(null);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    // Cleanup hit ancestorA (the cached one), NOT ancestorB.
    expect(ancestorA.hasAttribute('data-theme')).toBe(false);
    expect(ancestorB.hasAttribute('data-theme')).toBe(false);
  });

  // 7
  it('SSR-safe: canFullScreen returns false when document.fullscreenEnabled is false', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    const args = makeArgs();
    const { result } = renderHook(() => useFullScreen(args));
    expect(result.current.canFullScreen).toBe(false);
  });

  // 8a
  it('8a unmount cleanup — committed entry: fires onExitFullScreen, calls exitFullscreen, restores data-theme', async () => {
    const ancestor = document.createElement('div');
    ancestor.setAttribute('data-theme', 'brand-purple');
    document.body.appendChild(ancestor);

    const args = makeArgs();
    args.getFullScreenTargetRef.current = () => ancestor;
    args.onExitFullScreenRef.current = vi.fn();

    const { result, unmount } = renderHook(() => useFullScreen(args));

    await act(async () => { void result.current.enterFullScreen(); });
    setFullscreenElement(ancestor);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(ancestor.getAttribute('data-theme')).toBe('light');

    unmount();

    expect(args.onExitFullScreenRef.current).toHaveBeenCalledTimes(1);
    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(ancestor.getAttribute('data-theme')).toBe('brand-purple');
  });

  // 8b
  it('8b unmount cleanup — speculative entry: no onExitFullScreen, DOM data-theme restored, pending enter rejects', async () => {
    const ancestor = document.createElement('div');
    ancestor.setAttribute('data-theme', 'brand-purple');
    document.body.appendChild(ancestor);

    const args = makeArgs();
    args.getFullScreenTargetRef.current = () => ancestor;
    args.onEnterFullScreenRef.current = vi.fn();
    args.onExitFullScreenRef.current = vi.fn();

    HTMLElement.prototype.requestFullscreen = vi.fn().mockReturnValue(new Promise<void>(() => { /* never resolves */ }));

    const { result, unmount } = renderHook(() => useFullScreen(args));

    let enterPromise!: Promise<void>;
    await act(async () => { enterPromise = result.current.enterFullScreen(); });
    expect(ancestor.getAttribute('data-theme')).toBe('light');

    let caught: unknown;
    enterPromise.catch((err) => { caught = err; });

    unmount();
    await Promise.resolve();

    expect(args.onEnterFullScreenRef.current).not.toHaveBeenCalled();
    expect(args.onExitFullScreenRef.current).not.toHaveBeenCalled();
    expect(ancestor.getAttribute('data-theme')).toBe('brand-purple');
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('viewer unmounted before fullscreen enter committed');
  });

  // 8c
  it('8c unmount cleanup — exit in-flight: onExitFullScreen still fires, pending exit rejects', async () => {
    const args = makeArgs();
    args.onExitFullScreenRef.current = vi.fn();

    document.exitFullscreen = vi.fn().mockReturnValue(new Promise<void>(() => { /* never resolves */ }));

    const { result, unmount } = renderHook(() => useFullScreen(args));

    await act(async () => { void result.current.enterFullScreen(); });
    setFullscreenElement(args.rootRef.current);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    // committedRef.current === true; simulate exit-in-flight: browser cleared
    // document.fullscreenElement synchronously but listener hasn't fired yet.
    setFullscreenElement(null);
    let exitPromise!: Promise<void>;
    await act(async () => { exitPromise = result.current.exitFullScreen(); });

    let caught: unknown;
    exitPromise.catch((err) => { caught = err; });

    unmount();
    await Promise.resolve();

    expect(args.onExitFullScreenRef.current).toHaveBeenCalledTimes(1);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('viewer unmounted before fullscreen exit committed');
  });

  // 9
  it('multi-instance phantom-exit prevention: speculative-not-committed fullscreenchange does NOT fire onExitFullScreen', async () => {
    const args = makeArgs();
    args.onEnterFullScreenRef.current = vi.fn();
    args.onExitFullScreenRef.current = vi.fn();

    let resolveRequest!: () => void;
    HTMLElement.prototype.requestFullscreen = vi.fn().mockReturnValue(new Promise<void>((res) => { resolveRequest = res; }));

    const { result } = renderHook(() => useFullScreen(args));

    let enterPromise!: Promise<void>;
    await act(async () => { enterPromise = result.current.enterFullScreen(); });

    const otherEl = document.createElement('div');
    document.body.appendChild(otherEl);
    setFullscreenElement(otherEl);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    expect(args.dispatch).not.toHaveBeenCalled();
    expect(args.onExitFullScreenRef.current).not.toHaveBeenCalled();
    expect(await isPending(enterPromise)).toBe(true);

    // Now resolve and dispatch a second fullscreenchange where the document
    // owner is OUR target — verify normal enter path runs.
    resolveRequest();
    setFullscreenElement(args.rootRef.current);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await enterPromise;
    expect(args.onEnterFullScreenRef.current).toHaveBeenCalledTimes(1);
    expect(args.dispatch).toHaveBeenCalledWith({ type: 'SET_FULLSCREEN', value: true });
  });

  // 10
  it('unrelated fullscreen activity ignored: no speculative target → listener early-returns', async () => {
    const args = makeArgs();
    args.onEnterFullScreenRef.current = vi.fn();
    args.onExitFullScreenRef.current = vi.fn();

    renderHook(() => useFullScreen(args));

    const otherEl = document.createElement('div');
    document.body.appendChild(otherEl);
    setFullscreenElement(otherEl);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    expect(args.dispatch).not.toHaveBeenCalled();
    expect(args.onEnterFullScreenRef.current).not.toHaveBeenCalled();
    expect(args.onExitFullScreenRef.current).not.toHaveBeenCalled();
  });

  // 11
  it('transition Promise contract: enter Promise resolves AFTER the listener fires', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFullScreen(args));

    let enterPromise!: Promise<void>;
    await act(async () => { enterPromise = result.current.enterFullScreen(); });

    // requestFullscreen resolved, but listener has NOT fired — Promise pending.
    expect(await isPending(enterPromise)).toBe(true);

    setFullscreenElement(args.rootRef.current);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await enterPromise;
  });

  // 12
  it('duplicate-call dedup: rapid double-call shares the SAME Promise; callback fires exactly once', async () => {
    const args = makeArgs();
    args.onEnterFullScreenRef.current = vi.fn();

    let resolveRequest!: () => void;
    HTMLElement.prototype.requestFullscreen = vi.fn().mockReturnValue(new Promise<void>((res) => { resolveRequest = res; }));

    const { result } = renderHook(() => useFullScreen(args));

    let p1!: Promise<void>;
    let p2!: Promise<void>;
    await act(async () => {
      p1 = result.current.enterFullScreen();
      p2 = result.current.enterFullScreen();
    });

    expect(Object.is(p1, p2)).toBe(true);

    resolveRequest();
    setFullscreenElement(args.rootRef.current);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await Promise.all([p1, p2]);
    expect(args.onEnterFullScreenRef.current).toHaveBeenCalledTimes(1);
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  // 13a
  it('13a unrelated-fullscreen exit: actions.exitFullScreen() does NOT call document.exitFullscreen', async () => {
    const args = makeArgs();
    const otherEl = document.createElement('div');
    document.body.appendChild(otherEl);
    setFullscreenElement(otherEl);

    const { result } = renderHook(() => useFullScreen(args));

    await act(async () => { await result.current.exitFullScreen(); });
    expect(document.exitFullscreen).not.toHaveBeenCalled();
  });

  // 13b
  it('13b unrelated-fullscreen toggle: routes to enter, which no-ops via document.fullscreenElement guard', async () => {
    const args = makeArgs();
    const otherEl = document.createElement('div');
    document.body.appendChild(otherEl);
    setFullscreenElement(otherEl);

    const { result } = renderHook(() => useFullScreen(args));

    await act(async () => { await result.current.toggleFullScreen(); });
    expect(HTMLElement.prototype.requestFullscreen).not.toHaveBeenCalled();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
  });

  // 13c
  it('13c unrelated-fullscreen enter: actions.enterFullScreen() does NOT call target.requestFullscreen', async () => {
    const args = makeArgs();
    const otherEl = document.createElement('div');
    document.body.appendChild(otherEl);
    setFullscreenElement(otherEl);

    const { result } = renderHook(() => useFullScreen(args));

    await act(async () => { await result.current.enterFullScreen(); });
    expect(HTMLElement.prototype.requestFullscreen).not.toHaveBeenCalled();
  });

  // 14
  it('theme attribute preserved through enter/exit cycle (with and without pre-existing attribute)', async () => {
    // Variant A: pre-existing data-theme is preserved.
    const ancestorA = document.createElement('div');
    ancestorA.setAttribute('data-theme', 'brand-purple');
    document.body.appendChild(ancestorA);

    const argsA = makeArgs();
    argsA.getFullScreenTargetRef.current = () => ancestorA;

    const { result: resultA, unmount: unmountA } = renderHook(() => useFullScreen(argsA));

    await act(async () => { void resultA.current.enterFullScreen(); });
    setFullscreenElement(ancestorA);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(ancestorA.getAttribute('data-theme')).toBe('light');

    setFullscreenElement(null);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(ancestorA.getAttribute('data-theme')).toBe('brand-purple');
    unmountA();

    // Variant B: no pre-existing data-theme → exit removes the attribute.
    const ancestorB = document.createElement('div');
    document.body.appendChild(ancestorB);

    const argsB = makeArgs();
    argsB.getFullScreenTargetRef.current = () => ancestorB;

    const { result: resultB } = renderHook(() => useFullScreen(argsB));

    await act(async () => { void resultB.current.enterFullScreen(); });
    setFullscreenElement(ancestorB);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(ancestorB.getAttribute('data-theme')).toBe('light');

    setFullscreenElement(null);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await waitFor(() => expect(ancestorB.hasAttribute('data-theme')).toBe(false));
  });
});
