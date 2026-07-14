// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

afterEach(cleanup);
import { Flipbook } from '../Flipbook';
import type { PageSource, LinkAnnotation } from '../types/PageSource';

// Mock PdfjsSource so the `url` prop path doesn't try to load real PDFs.
// Use a regular `function` (not arrow) so `new PdfjsSource(...)` works —
// arrow functions lack the [[Construct]] internal slot.
vi.mock('../adapters/PdfjsSource', () => ({
  PdfjsSource: vi.fn(function (this: any) {
    Object.assign(this, createMockSource());
  }),
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

  it('forwards the `pdfjsOptions` prop to the internal PdfjsSource constructor', async () => {
    const { PdfjsSource } = await import('../adapters/PdfjsSource');
    const pdfjsSourceMock = vi.mocked(PdfjsSource);
    const callCountBefore = pdfjsSourceMock.mock.calls.length;

    const opts = { wasmUrl: 'https://cdn.example.com/pdfjs/wasm/' };
    render(<Flipbook url="/x.pdf" pdfjsOptions={opts} />);

    expect(pdfjsSourceMock.mock.calls.length).toBe(callCountBefore + 1);
    expect(pdfjsSourceMock.mock.calls[callCountBefore]).toEqual(['/x.pdf', opts]);
  });

  it('renders LinkOverlay by default when source implements getLinks', async () => {
    const source = createMockSource({
      getLinks: vi.fn((): Promise<LinkAnnotation[]> => Promise.resolve([
        { rect: [0, 0, 10, 10], url: 'https://a.example' },
      ])),
    });
    const { container } = render(<Flipbook source={source} />);
    await waitFor(() => expect(screen.getByTestId('fbjs-ready')).toBeTruthy());
    await waitFor(() => {
      expect(container.querySelector('.fbjs-link-overlay')).not.toBeNull();
    });
    expect(source.getLinks).toHaveBeenCalledWith(expect.any(Number), expect.any(AbortSignal));
  });

  it('internal link click updates the current page', async () => {
    const source = createMockSource({
      getPageCount: vi.fn(() => 10),
      // Return the link ONLY for page 0 — overscan mounts pages 1 and 2
      // simultaneously, and they must NOT also produce fbjs-link elements
      // (which would break getByTestId's single-match assumption).
      getLinks: vi.fn((idx: number): Promise<LinkAnnotation[]> => Promise.resolve(
        idx === 0
          ? [{ rect: [0, 0, 10, 10], destPage: 4 }]  // → goToPage(5)
          : [],
      )),
    });
    const { container } = render(<Flipbook source={source} />);
    await waitFor(() => expect(screen.getByTestId('fbjs-ready')).toBeTruthy());

    // Scope to the currently-visible spread — the ONE .fbjs-spread without
    // aria-hidden="true". Even if a stray fbjs-link appears elsewhere, we
    // click the correct one.
    const findVisibleSpread = () => {
      const spreads = container.querySelectorAll('.fbjs-spread');
      return Array.from(spreads).find(el => !el.hasAttribute('aria-hidden'));
    };
    await waitFor(() => {
      const vs = findVisibleSpread();
      expect(vs?.querySelector('[data-testid="fbjs-link"]')).not.toBeNull();
    });
    (findVisibleSpread()!.querySelector('[data-testid="fbjs-link"]') as HTMLButtonElement).click();

    // After the click, the visible spread should contain page 5 (1-indexed).
    await waitFor(() => {
      const vs = findVisibleSpread();
      expect(vs).toBeTruthy();
      expect(vs!.querySelector('[aria-label="Page 5"]')).not.toBeNull();
    });
  });

  it('does not render LinkOverlay when showLinks={false}', async () => {
    const source = createMockSource({
      getLinks: vi.fn((): Promise<LinkAnnotation[]> => Promise.resolve([{ rect: [0, 0, 10, 10], url: 'https://a.example' }])),
    });
    const { container } = render(<Flipbook source={source} showLinks={false} />);
    await waitFor(() => expect(screen.getByTestId('fbjs-ready')).toBeTruthy());
    expect(container.querySelector('.fbjs-link-overlay')).toBeNull();
  });
});
