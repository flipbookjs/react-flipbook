import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import { LABELS } from '../toolbar/labels';
import type { PageSource } from '../types/PageSource';

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

describe('Flipbook toolbar prop dispatch', () => {
  it('toolbar omitted (default) renders built-in <Toolbar>', async () => {
    const source = makeSource();
    render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: LABELS.toolbarBottomBarLabel })).toBeInTheDocument();
    });
  });

  it('toolbar={true} renders built-in <Toolbar>', async () => {
    const source = makeSource();
    render(<Flipbook source={source} toolbar={true} />);
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: LABELS.toolbarBottomBarLabel })).toBeInTheDocument();
    });
  });

  it('toolbar={false} renders no chrome (.fbjs-root present, no toolbars inside)', async () => {
    const source = makeSource();
    const { container } = render(<Flipbook source={source} toolbar={false} />);
    await waitFor(() => {
      expect(container.querySelector('.fbjs-root')).not.toBeNull();
    });
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('toolbar={<CustomBar/>} renders the consumer JSX in the top slot; no built-in toolbars', async () => {
    // Changed in 1.0.0: single ReactNode previously rendered in the BOTTOM
    // slot (the 0.1.0-alpha.1 behavior). The position swap is documented at
    // MIGRATION.md §6.2 and in the FlipbookCustomToolbarProps JSDoc.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const source = makeSource();
      function CustomBar() {
        return <div data-testid="my-custom-bar">Custom toolbar content</div>;
      }
      const { container } = render(<Flipbook source={source} toolbar={<CustomBar />} />);
      await waitFor(() => {
        expect(screen.getByTestId('my-custom-bar')).toBeInTheDocument();
      });
      expect(screen.queryByRole('toolbar', { name: LABELS.toolbarTopBarLabel })).toBeNull();
      expect(screen.queryByRole('toolbar', { name: LABELS.toolbarBottomBarLabel })).toBeNull();
      // Slot-position assertion: the custom marker is rendered BEFORE the
      // `.fbjs-container` viewport div (top slot at FlipbookProvider:1039;
      // viewport at FlipbookProvider:1040-1085).
      const marker = screen.getByTestId('my-custom-bar');
      const viewport = container.querySelector('.fbjs-container');
      expect(viewport).not.toBeNull();
      expect(marker.compareDocumentPosition(viewport!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('toolbar={null} (ReactNode null) falls through to built-in (treated like undefined via == null)', async () => {
    const source = makeSource();
    render(<Flipbook source={source} toolbar={null} />);
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: LABELS.toolbarBottomBarLabel })).toBeInTheDocument();
    });
  });

  it('toolbar={{ top, bottom }} slot object renders consumer nodes in both slots independently', async () => {
    const source = makeSource();
    render(
      <Flipbook
        source={source}
        toolbar={{
          top: <div data-testid="my-top">Top custom</div>,
          bottom: <div data-testid="my-bottom">Bottom custom</div>,
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('my-top')).toBeInTheDocument();
    });
    expect(screen.getByTestId('my-bottom')).toBeInTheDocument();
    // No built-in toolbars.
    expect(screen.queryByRole('toolbar', { name: LABELS.toolbarTopBarLabel })).toBeNull();
    expect(screen.queryByRole('toolbar', { name: LABELS.toolbarBottomBarLabel })).toBeNull();
  });

  it('toolbar={{ top }} only renders the top slot; bottom slot is null', async () => {
    const source = makeSource();
    render(
      <Flipbook
        source={source}
        toolbar={{ top: <div data-testid="only-top">Only top</div> }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('only-top')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('my-bottom')).toBeNull();
  });
});
