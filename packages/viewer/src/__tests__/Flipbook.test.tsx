// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

afterEach(cleanup);
import { Flipbook } from '../Flipbook';
import type { PageSource } from '../types/PageSource';

// Mock PdfjsSource so the `url` prop path doesn't try to load real PDFs
vi.mock('../adapters/PdfjsSource', () => ({
  PdfjsSource: vi.fn().mockImplementation(() => createMockSource()),
}));

vi.mock('../adapters/configurePdfWorker', () => ({
  configurePdfWorker: vi.fn(),
}));

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

describe('Flipbook', () => {
  it('renders loading state initially', () => {
    const source = createMockSource({
      init: () => new Promise(() => {}), // never resolves
    });
    render(<Flipbook source={source} />);
    const loaderText = screen.getByText('Loading…');
    expect(loaderText.closest('[role="status"]')).toHaveClass('fbjs-loading');
  });

  it('renders page after source loads', async () => {
    const source = createMockSource();
    render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });
  });

  it('renders error state on init failure', async () => {
    const source = createMockSource({
      init: () => Promise.reject(new Error('Network error')),
    });
    render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByText('Network error')).toBeTruthy();
  });

  it('renders custom error via renderError prop', async () => {
    const source = createMockSource({
      init: () => Promise.reject(new Error('Custom fail')),
    });
    render(
      <Flipbook
        source={source}
        renderError={(err) => <div data-testid="custom-error">{err.message}</div>}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('custom-error')).toBeTruthy();
    });
    expect(screen.getByText('Custom fail')).toBeTruthy();
  });

  it('renders custom loading via renderLoading prop', () => {
    const source = createMockSource({
      init: () => new Promise(() => {}),
    });
    render(
      <Flipbook
        source={source}
        renderLoading={() => <div data-testid="custom-loading">Please wait</div>}
      />,
    );
    expect(screen.getByTestId('custom-loading')).toBeTruthy();
  });

  it('throws when neither url nor source provided', () => {
    expect(() => render(<Flipbook />)).toThrow(
      'Flipbook requires either a `url` or `source` prop',
    );
  });

  it('calls dispose on unmount', async () => {
    const source = createMockSource();
    const { unmount } = render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });
    unmount();
    expect(source.dispose).toHaveBeenCalled();
  });

  it('clears stale error when source changes', async () => {
    const failingSource = createMockSource({
      init: () => Promise.reject(new Error('Source A failed')),
    });
    const { rerender } = render(<Flipbook source={failingSource} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByText('Source A failed')).toBeTruthy();

    // Swap to a working source — stale error should disappear, loading should show
    const workingSource = createMockSource();
    rerender(<Flipbook source={workingSource} />);
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    // Should show loading while new source initializes, then ready
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });
  });
});
