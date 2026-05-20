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
    getPageCount: vi.fn(() => 10),
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

describe('useKeyboard', () => {
  it('ArrowRight navigates to next spread', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const container = screen.getByRole('region', { name: 'Document viewer' });
    container.focus();
    await userEvent.keyboard('{ArrowRight}');

    await waitFor(() => {
      expect(screen.getByText(/Page 2 of 10/)).toBeTruthy();
    });

    // Verify the visible spread changed — non-aria-hidden spread should
    // contain page 2's PageRenderer, not page 1's
    const ready = screen.getByTestId('fbjs-ready');
    const visibleSpread = ready.querySelector('.fbjs-spread:not([aria-hidden])');
    expect(visibleSpread).not.toBeNull();
    expect(visibleSpread!.querySelector('[aria-label="Page 2"]')).not.toBeNull();
  });

  it('ArrowLeft navigates to previous spread', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="single" initialPage={2} />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const container = screen.getByRole('region', { name: 'Document viewer' });
    container.focus();
    await userEvent.keyboard('{ArrowLeft}');

    await waitFor(() => {
      expect(screen.getByText(/Page 2 of 10/)).toBeTruthy();
    });
  });

  it('Home navigates to first spread', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="single" initialPage={5} />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const container = screen.getByRole('region', { name: 'Document viewer' });
    container.focus();
    await userEvent.keyboard('{Home}');

    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 10/)).toBeTruthy();
    });
  });

  it('End navigates to last spread', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const container = screen.getByRole('region', { name: 'Document viewer' });
    container.focus();
    await userEvent.keyboard('{End}');

    await waitFor(() => {
      expect(screen.getByText(/Page 10 of 10/)).toBeTruthy();
    });
  });

  it('ArrowLeft at first spread stays at first', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const container = screen.getByRole('region', { name: 'Document viewer' });
    container.focus();
    await userEvent.keyboard('{ArrowLeft}');

    // Should still show page 1
    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 10/)).toBeTruthy();
    });
  });

  it('ArrowRight at last spread stays at last', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} viewMode="single" initialPage={9} />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const container = screen.getByRole('region', { name: 'Document viewer' });
    container.focus();
    await userEvent.keyboard('{ArrowRight}');

    // Should still show page 10
    await waitFor(() => {
      expect(screen.getByText(/Page 10 of 10/)).toBeTruthy();
    });
  });
});
