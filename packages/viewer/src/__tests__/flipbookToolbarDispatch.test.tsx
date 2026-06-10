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

  it('toolbar={<CustomBar/>} renders the consumer JSX in the bottom slot; no built-in toolbars', async () => {
    const source = makeSource();
    function CustomBar() {
      return <div data-testid="my-custom-bar">Custom toolbar content</div>;
    }
    render(<Flipbook source={source} toolbar={<CustomBar />} />);
    await waitFor(() => {
      expect(screen.getByTestId('my-custom-bar')).toBeInTheDocument();
    });
    expect(screen.queryByRole('toolbar', { name: LABELS.toolbarTopBarLabel })).toBeNull();
    expect(screen.queryByRole('toolbar', { name: LABELS.toolbarBottomBarLabel })).toBeNull();
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
