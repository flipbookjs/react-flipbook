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

describe('SpreadRenderer', () => {
  it('renders a single page in single mode', async () => {
    const source = createMockSource({ getPageCount: vi.fn(() => 3) });
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const spreads = screen.getByTestId('fbjs-ready').querySelectorAll('.fbjs-spread');
    // Render window: currentSpreadIndex=0, overscan=1 → window=[0, min(2,1)]=[0,1] → exactly 2 spreads
    expect(spreads.length).toBe(2);

    const currentSpread = spreads[0];
    const slots = currentSpread.querySelectorAll('.fbjs-slot');
    expect(slots.length).toBe(1);
  });

  it('renders two slots in dual-cover mode', async () => {
    const source = createMockSource({ getPageCount: vi.fn(() => 5) });
    render(<Flipbook source={source} viewMode="dual-cover" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const spreads = screen.getByTestId('fbjs-ready').querySelectorAll('.fbjs-spread');
    // Dual-cover with pageCount=5: spreads=[cover, interior, interior], window=[0,1] → exactly 2 spreads
    expect(spreads.length).toBe(2);

    const currentSpread = spreads[0];
    const slots = currentSpread.querySelectorAll('.fbjs-slot');
    expect(slots.length).toBe(2);
  });

  it('sets slot dimensions from page size and scale', async () => {
    const source = createMockSource({
      getPageCount: vi.fn(() => 1),
      getPageSize: vi.fn(() => ({ width: 100, height: 200 })),
    });
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const slot = screen.getByTestId('fbjs-ready').querySelector('.fbjs-slot');
    expect(slot).not.toBeNull();
    const style = (slot as HTMLElement).style;
    expect(parseFloat(style.width)).toBeGreaterThan(0);
    expect(parseFloat(style.height)).toBeGreaterThan(0);
  });

  it('marks non-current spreads as aria-hidden', async () => {
    const source = createMockSource({ getPageCount: vi.fn(() => 5) });
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const spreads = screen.getByTestId('fbjs-ready').querySelectorAll('.fbjs-spread');
    expect(spreads.length).toBeGreaterThanOrEqual(2);

    // First spread (current) should NOT have aria-hidden attribute
    expect(spreads[0].hasAttribute('aria-hidden')).toBe(false);
    // Second spread (overscan) should be aria-hidden
    expect(spreads[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('renders PageRenderer for occupied slots', async () => {
    const source = createMockSource({ getPageCount: vi.fn(() => 3) });
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    await waitFor(() => {
      const pages = screen.getByTestId('fbjs-ready').querySelectorAll('.fbjs-page');
      expect(pages.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('unmounts spreads that leave the render window', async () => {
    // 5 pages in single mode = 5 spreads. Overscan = 1.
    // At spread 0: window = [0, 1]. Navigate to spread 2: window = [1, 3].
    // Spread 0 should leave the DOM entirely.
    const renderPage = vi.fn(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 612;
      canvas.height = 792;
      return Promise.resolve(canvas);
    });
    const source = createMockSource({
      getPageCount: vi.fn(() => 5),
      renderPage,
    });
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const ready = screen.getByTestId('fbjs-ready');
    let spreads = ready.querySelectorAll('.fbjs-spread');
    expect(spreads.length).toBe(2);

    const container = screen.getByRole('region', { name: 'Document viewer' });
    container.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');

    await waitFor(() => {
      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion!.textContent).toBe('Page 3 of 5');
    });

    // Spread 0 should have left the DOM. Window = [1, 3] = 3 spreads.
    spreads = ready.querySelectorAll('.fbjs-spread');
    expect(spreads.length).toBe(3);

    const page1 = ready.querySelector('[aria-label="Page 1"]');
    expect(page1).toBeNull();
  });

  it('does not render PageRenderer for blank slots', async () => {
    // 1-page document in dual-cover: spread 0 = { left: null, right: 0 }
    const source = createMockSource({ getPageCount: vi.fn(() => 1) });
    render(<Flipbook source={source} viewMode="dual-cover" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    const currentSpread = screen.getByTestId('fbjs-ready').querySelector('.fbjs-spread');
    const slots = currentSpread!.querySelectorAll('.fbjs-slot');
    expect(slots.length).toBe(2);

    const leftSlotPages = slots[0].querySelectorAll('.fbjs-page');
    expect(leftSlotPages.length).toBe(0);

    await waitFor(() => {
      const rightSlotPages = slots[1].querySelectorAll('.fbjs-page');
      expect(rightSlotPages.length).toBe(1);
    });
  });

  it('renders no spreads for a 0-page document', async () => {
    // Critical guard: source.getPageSize(0) would throw on an empty source
    // (PdfjsSource.pageSizes is []). SpreadRenderer must return null before
    // any getPageSize call. The mock's getPageSize would not be called.
    const getPageSize = vi.fn(() => {
      throw new Error('getPageSize must not be called for 0-page documents');
    });
    const source = createMockSource({
      getPageCount: vi.fn(() => 0),
      getPageSize,
    });
    render(<Flipbook source={source} viewMode="single" />);
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-ready')).toBeTruthy();
    });

    // No spreads should render
    const spreads = screen.getByTestId('fbjs-ready').querySelectorAll('.fbjs-spread');
    expect(spreads.length).toBe(0);

    // The poisoned getPageSize must not have been called
    expect(getPageSize).not.toHaveBeenCalled();
  });
});
