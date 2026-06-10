// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent, cleanup } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import type { PageSource } from '../types/PageSource';

vi.mock('../adapters/PdfjsSource', () => ({
  PdfjsSource: vi.fn().mockImplementation(() => createMockSource()),
}));
vi.mock('../adapters/configurePdfWorker', () => ({ configurePdfWorker: vi.fn() }));

function createMockSource(overrides?: Partial<PageSource>): PageSource {
  return {
    init: vi.fn(() => Promise.resolve()),
    getPageCount: vi.fn(() => 1),
    getPageSize: vi.fn(() => ({ width: 612, height: 792 })),
    renderPage: vi.fn(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 612;
      canvas.height = 792;
      return Promise.resolve(canvas);
    }),
    dispose: vi.fn(),
    ...overrides,
  };
}

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: el, writable: true });
}

function getFullScreenButton(): HTMLButtonElement | null {
  return document.querySelector('[data-testid="fbjs-fullscreen-button"]');
}

function getRoot(): HTMLDivElement {
  const el = document.querySelector('.fbjs-root') as HTMLDivElement | null;
  if (el === null) throw new Error('fbjs-root not found');
  return el;
}

function getContainer(): HTMLDivElement {
  const el = document.querySelector('.fbjs-container') as HTMLDivElement | null;
  if (el === null) throw new Error('fbjs-container not found');
  return el;
}

beforeEach(() => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  setFullscreenElement(null);
  HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setFullscreenElement(null);
});

describe('Flipbook fullscreen end-to-end', () => {
  // 1
  it('shows the fullscreen button when canFullScreen=true', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} />);
    await waitFor(() => expect(getFullScreenButton()).not.toBeNull());
  });

  // 2
  it('click → toggleFullScreen → aria-pressed flips after fullscreenchange', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} />);
    await waitFor(() => expect(getFullScreenButton()).not.toBeNull());

    const button = getFullScreenButton()!;
    expect(button.getAttribute('aria-pressed')).toBe('false');

    await act(async () => { fireEvent.click(button); });

    setFullscreenElement(getRoot());
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await waitFor(() => expect(getFullScreenButton()!.getAttribute('aria-pressed')).toBe('true'));
  });

  // 3
  it('onEnterFullScreen consumer callback fires after entry', async () => {
    const source = createMockSource();
    const onEnter = vi.fn();
    render(<Flipbook source={source} onEnterFullScreen={onEnter} />);
    await waitFor(() => expect(getFullScreenButton()).not.toBeNull());

    await act(async () => { fireEvent.click(getFullScreenButton()!); });
    setFullscreenElement(getRoot());
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  // 4
  it('Esc-key simulation: fullscreenchange with fullscreenElement=null → state flips back, onExitFullScreen fires', async () => {
    const source = createMockSource();
    const onEnter = vi.fn();
    const onExit = vi.fn();
    render(<Flipbook source={source} onEnterFullScreen={onEnter} onExitFullScreen={onExit} />);
    await waitFor(() => expect(getFullScreenButton()).not.toBeNull());

    await act(async () => { fireEvent.click(getFullScreenButton()!); });
    setFullscreenElement(getRoot());
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    await waitFor(() => expect(getFullScreenButton()!.getAttribute('aria-pressed')).toBe('true'));

    // Simulate Esc — browser exits fullscreen, dispatches fullscreenchange with null.
    setFullscreenElement(null);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await waitFor(() => expect(getFullScreenButton()!.getAttribute('aria-pressed')).toBe('false'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  // 5
  it('getFullScreenTarget returning null → falls back to .fbjs-root, dev-warn fires', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
    const source = createMockSource();
    render(<Flipbook source={source} getFullScreenTarget={() => null} />);
    await waitFor(() => expect(getFullScreenButton()).not.toBeNull());

    await act(async () => { fireEvent.click(getFullScreenButton()!); });

    const spy = HTMLElement.prototype.requestFullscreen as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(getRoot());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('getFullScreenTarget returned null'),
    );

    // Settle the pending Promise to avoid cleanup() unhandled rejection.
    setFullscreenElement(getRoot());
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
  });

  // 6a
  it('6a focus restoration to originating button after exit', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} />);
    await waitFor(() => expect(getFullScreenButton()).not.toBeNull());

    const button = getFullScreenButton()!;
    await act(async () => { fireEvent.click(button); });
    setFullscreenElement(getRoot());
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    setFullscreenElement(null);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  // 6b
  it('6b focus restoration to .fbjs-container when originating button has unmounted', async () => {
    const source = createMockSource();
    const { rerender } = render(<Flipbook source={source} />);
    await waitFor(() => expect(getFullScreenButton()).not.toBeNull());

    const button = getFullScreenButton()!;
    await act(async () => { fireEvent.click(button); });
    setFullscreenElement(getRoot());
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    // Re-render with toolbar removed — the button unmounts.
    rerender(<Flipbook source={source} toolbar={false} />);
    await waitFor(() => expect(getFullScreenButton()).toBeNull());

    setFullscreenElement(null);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await waitFor(() => expect(document.activeElement).toBe(getContainer()));
  });

  // 7
  it('unrelated fullscreen activity: viewer ignores fullscreenchange from a different element', async () => {
    const source = createMockSource();
    const onEnter = vi.fn();
    const onExit = vi.fn();
    render(<Flipbook source={source} onEnterFullScreen={onEnter} onExitFullScreen={onExit} />);
    await waitFor(() => expect(getFullScreenButton()).not.toBeNull());

    const otherEl = document.createElement('div');
    document.body.appendChild(otherEl);
    setFullscreenElement(otherEl);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    expect(getFullScreenButton()!.getAttribute('aria-pressed')).toBe('false');
    expect(onEnter).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });
});
