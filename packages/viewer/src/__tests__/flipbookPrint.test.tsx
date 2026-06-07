// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent, cleanup } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import * as devWarnModule from '../core/devWarn';
import type { PageSource } from '../types/PageSource';

// ---- JSDOM stub scaffolding (same as 5.1) ----
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalPrint = window.print;
const originalDecode = HTMLImageElement.prototype.decode;

let printSpy: ReturnType<typeof vi.fn>;
let devWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) =>
    cb(new Blob([], { type: 'image/png' })),
  ) as unknown as typeof originalToBlob;

  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

  printSpy = vi.fn();
  window.print = printSpy as unknown as typeof window.print;

  HTMLImageElement.prototype.decode = function () { return Promise.resolve(); };

  devWarnSpy = vi.spyOn(devWarnModule, 'devWarn').mockImplementation(() => {});
});

afterEach(() => {
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  window.print = originalPrint;
  HTMLImageElement.prototype.decode = originalDecode;
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---- Stub source helper ----
function makeStubSource(pageCount: number): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => pageCount,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(async () => {
      const c = document.createElement('canvas');
      c.width = 100; c.height = 100;
      return c;
    }) as unknown as PageSource['renderPage'],
    dispose: () => {},
  };
}

function getPrintButton(): HTMLButtonElement | null {
  return document.querySelector('[data-testid="fbjs-print-button"]');
}
function getBanner(): HTMLElement | null {
  return document.querySelector('.fbjs-print-error');
}
function getBannerMessage(): HTMLElement | null {
  return document.querySelector('.fbjs-print-error__message');
}
function getBannerDismiss(): HTMLButtonElement | null {
  return document.querySelector('.fbjs-print-error__dismiss');
}
function getToolbarStack(): HTMLElement | null {
  return document.querySelector('.fbjs-toolbar-stack');
}

describe('Flipbook print — Phase 5.2 (E2E)', () => {
  // 1
  it('1. Click PrintButton → isPrinting flips true + spinner icon swap', async () => {
    const source = makeStubSource(2);
    render(<Flipbook source={source} />);
    await waitFor(() => expect(getPrintButton()).not.toBeNull());
    const btn = getPrintButton()!;
    expect(btn.getAttribute('aria-disabled')).not.toBe('true');
    // Confirm initial icon is the printer (NOT the spinner).
    expect(btn.querySelector('.fbjs-toolbar__spinner')).toBeNull();

    await act(async () => { fireEvent.click(btn); });
    // While printing: button disabled + spinner present.
    await waitFor(() => {
      expect(getPrintButton()!.getAttribute('aria-disabled')).toBe('true');
      expect(getPrintButton()!.querySelector('.fbjs-toolbar__spinner')).not.toBeNull();
    });
  });

  // 2
  it('2. Over printMaxPages → banner renders with role="status" + message + is SIBLING of ToolbarShell', async () => {
    const source = makeStubSource(50);
    render(<Flipbook source={source} printMaxPages={5} />);
    await waitFor(() => expect(getPrintButton()).not.toBeNull());

    await act(async () => { fireEvent.click(getPrintButton()!); });

    await waitFor(() => expect(getBanner()).not.toBeNull());
    const message = getBannerMessage()!;
    expect(message.getAttribute('role')).toBe('status');
    expect(message.getAttribute('aria-live')).toBe('polite');
    expect(message.textContent).toContain('50 pages');
    expect(message.textContent).toContain('limit 5');

    // Banner is a sibling of the bottom ToolbarShell, NOT inside it.
    const banner = getBanner()!;
    const stack = getToolbarStack()!;
    expect(stack).not.toBeNull();
    expect(banner.parentElement).toBe(stack);
    // Verify NO toolbar role is an ancestor of the banner.
    let cursor: HTMLElement | null = banner.parentElement;
    while (cursor) {
      expect(cursor.getAttribute?.('role')).not.toBe('toolbar');
      cursor = cursor.parentElement;
    }

    // Print button stays enabled (too-large is a guard, not a printing state).
    expect(getPrintButton()!.getAttribute('aria-disabled')).not.toBe('true');
  });

  // 3
  it('3. Banner dismiss click → clears state + banner unmounts', async () => {
    const source = makeStubSource(50);
    render(<Flipbook source={source} printMaxPages={5} printErrorDismissMs={0} />);
    await waitFor(() => expect(getPrintButton()).not.toBeNull());

    await act(async () => { fireEvent.click(getPrintButton()!); });
    await waitFor(() => expect(getBanner()).not.toBeNull());

    await act(async () => { fireEvent.click(getBannerDismiss()!); });
    await waitFor(() => expect(getBanner()).toBeNull());
  });

  // 4
  it('4. Auto-dismiss after printErrorDismissMs={500}', async () => {
    vi.useFakeTimers();
    const source = makeStubSource(50);
    render(<Flipbook source={source} printMaxPages={5} printErrorDismissMs={500} />);
    // waitFor under fake timers needs the timers advanced; use act + immediate queue drain.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getPrintButton()).not.toBeNull();

    await act(async () => { fireEvent.click(getPrintButton()!); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getBanner()).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(getBanner()).toBeNull();
  });

  // 5
  it('5. printErrorDismissMs={0} → auto-dismiss disabled', async () => {
    vi.useFakeTimers();
    const source = makeStubSource(50);
    render(<Flipbook source={source} printMaxPages={5} printErrorDismissMs={0} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    await act(async () => { fireEvent.click(getPrintButton()!); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getBanner()).not.toBeNull();

    // Advance 60 seconds — banner persists.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getBanner()).not.toBeNull();
  });

  // 6
  it('6. printErrorDismissMs={NaN} → auto-dismiss disabled (L3)', async () => {
    vi.useFakeTimers();
    const source = makeStubSource(50);
    render(<Flipbook source={source} printMaxPages={5} printErrorDismissMs={NaN} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    await act(async () => { fireEvent.click(getPrintButton()!); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getBanner()).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getBanner()).not.toBeNull();
  });

  // 7
  it('7. Re-dispatch fresh identity → auto-dismiss timer resets', async () => {
    vi.useFakeTimers();
    const source = makeStubSource(50);
    render(<Flipbook source={source} printMaxPages={5} printErrorDismissMs={8_000} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // First click → banner appears.
    await act(async () => { fireEvent.click(getPrintButton()!); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(getBanner()).not.toBeNull();

    // Advance 2s, then click again (re-dispatch with fresh identity).
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await act(async () => { fireEvent.click(getPrintButton()!); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // At 7s from FIRST dispatch (5s from second), banner still visible (timer reset).
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(getBanner()).not.toBeNull();

    // At 8s from second dispatch, banner unmounts.
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(getBanner()).toBeNull();
  });

  // 8
  it('8. printScale clamping + printMaxPages sanitization + per-value devWarn semantics', async () => {
    const source = makeStubSource(3);

    // ---- printScale boundary table ----
    // 10.0 → clamps to 6.0
    devWarnSpy.mockClear();
    const { unmount: u1 } = render(<Flipbook source={source} printScale={10.0} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    let lastWarn = devWarnSpy.mock.calls[devWarnSpy.mock.calls.length - 1][0] as string;
    expect(lastWarn).toContain('clamped to 6');
    u1();

    // 0.1 → clamps to 0.5
    devWarnSpy.mockClear();
    const { unmount: u2 } = render(<Flipbook source={source} printScale={0.1} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    lastWarn = devWarnSpy.mock.calls[devWarnSpy.mock.calls.length - 1][0] as string;
    expect(lastWarn).toContain('clamped to 0.5');
    u2();

    // Infinity → clamps to 6.0 (NOT default 2.0)
    devWarnSpy.mockClear();
    const { unmount: u3 } = render(<Flipbook source={source} printScale={Infinity} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    lastWarn = devWarnSpy.mock.calls[devWarnSpy.mock.calls.length - 1][0] as string;
    expect(lastWarn).toContain('clamped to 6');
    u3();

    // -Infinity → clamps to 0.5 (NOT default 2.0)
    devWarnSpy.mockClear();
    const { unmount: u4 } = render(<Flipbook source={source} printScale={-Infinity} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    lastWarn = devWarnSpy.mock.calls[devWarnSpy.mock.calls.length - 1][0] as string;
    expect(lastWarn).toContain('clamped to 0.5');
    u4();

    // NaN → fallback to default 2.0
    devWarnSpy.mockClear();
    const { unmount: u5 } = render(<Flipbook source={source} printScale={NaN} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    lastWarn = devWarnSpy.mock.calls[devWarnSpy.mock.calls.length - 1][0] as string;
    expect(lastWarn).toContain('NaN');
    expect(lastWarn).toContain('default 2');
    u5();

    // ---- printMaxPages boundary table ----
    // NaN → default 100
    devWarnSpy.mockClear();
    const { unmount: u6 } = render(<Flipbook source={source} printMaxPages={NaN} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    lastWarn = devWarnSpy.mock.calls[devWarnSpy.mock.calls.length - 1][0] as string;
    expect(lastWarn).toContain('printMaxPages');
    expect(lastWarn).toContain('100');
    u6();

    // -5 → default 100
    devWarnSpy.mockClear();
    const { unmount: u7 } = render(<Flipbook source={source} printMaxPages={-5} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    lastWarn = devWarnSpy.mock.calls[devWarnSpy.mock.calls.length - 1][0] as string;
    expect(lastWarn).toContain('printMaxPages');
    expect(lastWarn).toContain('100');
    u7();

    // 0 → default 100
    devWarnSpy.mockClear();
    const { unmount: u8 } = render(<Flipbook source={source} printMaxPages={0} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    u8();

    // 0.5 → default 100 (the load-bearing `< 1` guard)
    devWarnSpy.mockClear();
    const { unmount: u9 } = render(<Flipbook source={source} printMaxPages={0.5} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    lastWarn = devWarnSpy.mock.calls[devWarnSpy.mock.calls.length - 1][0] as string;
    expect(lastWarn).toContain('printMaxPages');
    expect(lastWarn).toContain('100');
    u9();

    // 0.99 → default 100 (same guard)
    devWarnSpy.mockClear();
    const { unmount: u10 } = render(<Flipbook source={source} printMaxPages={0.99} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).toHaveBeenCalled();
    u10();

    // Infinity → opt-out, passes through, NO devWarn
    devWarnSpy.mockClear();
    const { unmount: u11 } = render(<Flipbook source={source} printMaxPages={Infinity} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).not.toHaveBeenCalled();
    u11();

    // 50.7 → floors to 50, NO devWarn (valid input)
    devWarnSpy.mockClear();
    const { unmount: u12 } = render(<Flipbook source={source} printMaxPages={50.7} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).not.toHaveBeenCalled();
    u12();

    // 1 → boundary, valid; NO devWarn
    devWarnSpy.mockClear();
    const { unmount: u13 } = render(<Flipbook source={source} printMaxPages={1} />);
    await act(async () => { await Promise.resolve(); });
    expect(devWarnSpy).not.toHaveBeenCalled();
    u13();

    // ---- F4 per-value re-warn: same invalid value on a second mount warns AGAIN ----
    devWarnSpy.mockClear();
    const { unmount: m1 } = render(<Flipbook source={source} printScale={10} />);
    await act(async () => { await Promise.resolve(); });
    const firstMountWarns = devWarnSpy.mock.calls.length;
    expect(firstMountWarns).toBeGreaterThan(0);
    m1();

    const { unmount: m2 } = render(<Flipbook source={source} printScale={10} />);
    await act(async () => { await Promise.resolve(); });
    // F4: per-value semantics — same value on second mount warns again (per-call useMemo).
    expect(devWarnSpy.mock.calls.length).toBeGreaterThan(firstMountWarns);
    m2();
  });
});
