// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

afterEach(cleanup);

import { Flipbook } from '../Flipbook';
import type { PageSource } from '../types/PageSource';

vi.mock('../adapters/PdfjsSource', () => ({
  PdfjsSource: vi.fn().mockImplementation(() => createMockSource()),
}));

vi.mock('../adapters/configurePdfWorker', () => ({
  configurePdfWorker: vi.fn(),
}));

function createMockSource(overrides?: Partial<PageSource>): PageSource {
  return {
    init: vi.fn(() => Promise.resolve()),
    getPageCount: vi.fn(() => 5),
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

describe('AriaAnnouncer', () => {
  it('announces current page in single mode', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.textContent).toBe('Page 1 of 5');
  });

  it('announces cover page in dual-cover mode', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="dual-cover" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    // Cover spread: { left: null, right: 0 } → "Page 1 of 5"
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.textContent).toBe('Page 1 of 5');
  });

  it('announces both pages in dual-cover interior spread', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="dual-cover" initialPage={1} />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    // Interior spread: { left: 1, right: 2 } → "Pages 2 and 3 of 5"
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.textContent).toBe('Pages 2 and 3 of 5');
  });

  it('updates announcement on navigation', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const container = screen.getByRole('region', { name: 'Document viewer' });
    container.focus();
    await userEvent.keyboard('{ArrowRight}');

    await waitFor(() => {
      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion!.textContent).toBe('Page 2 of 5');
    });
  });

  it('announces nothing for a 0-page document', async () => {
    // Guard: spreads is [] when pageCount === 0, so `spread` is undefined.
    // AriaAnnouncer's `if (!spread)` branch sets announcement to ''.
    const source = createMockSource({ getPageCount: vi.fn(() => 0) });
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.textContent).toBe('');
  });
});
