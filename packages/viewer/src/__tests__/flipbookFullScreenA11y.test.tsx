import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Flipbook } from '../Flipbook';
import type { PageSource } from '../types/PageSource';

expect.extend(toHaveNoViolations);

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 6,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: el, writable: true });
}

beforeEach(() => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  setFullscreenElement(null);
  HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  setFullscreenElement(null);
});

describe('Flipbook fullscreen a11y audit', () => {
  it('non-fullscreen state has zero violations', async () => {
    const source = makeSource();
    const { container } = render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="fbjs-fullscreen-button"]')).not.toBeNull();
    });
    const root = container.querySelector('.fbjs-root')!;
    const results = await axe(root);
    expect(results).toHaveNoViolations();
  });

  it('fullscreen state (state.isFullScreen=true simulated) has zero violations', async () => {
    const source = makeSource();
    const { container } = render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="fbjs-fullscreen-button"]')).not.toBeNull();
    });

    const root = container.querySelector('.fbjs-root') as HTMLDivElement;
    const button = container.querySelector('[data-testid="fbjs-fullscreen-button"]') as HTMLButtonElement;

    // JSDOM can't actually fullscreen, so simulate the listener commit:
    // click the button (drives toggleFullScreen → requestFullscreen mock),
    // then dispatch fullscreenchange with our root as the fullscreenElement.
    await act(async () => { fireEvent.click(button); });
    setFullscreenElement(root);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });

    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));

    const results = await axe(root);
    expect(results).toHaveNoViolations();

    // Settle the exit so cleanup() doesn't reject pending Promises.
    setFullscreenElement(null);
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
  });
});
