import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import { useFlipbookActions } from '../hooks/useFlipbook';
import { LABELS } from '../toolbar/labels';
import type { PageSource } from '../types/PageSource';

function makeSource(pageCount = 4): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => pageCount,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

describe('Flipbook thumbnails dispatch', () => {
  it('default <Flipbook> shows the toggle button', async () => {
    const source = makeSource();
    render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: LABELS.thumbnailsToggle })).toBeInTheDocument();
    });
  });

  it('showThumbnails={false} hides the toggle button', async () => {
    const source = makeSource();
    const { container } = render(<Flipbook source={source} showThumbnails={false} />);
    await waitFor(() => {
      expect(container.querySelector('.fbjs-toolbar__bar--bottom')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: LABELS.thumbnailsToggle })).toBeNull();
  });

  it('clicking the toggle opens the panel', async () => {
    const source = makeSource();
    render(<Flipbook source={source} />);
    const button = await screen.findByRole('button', { name: LABELS.thumbnailsToggle });
    act(() => { button.click(); });
    await waitFor(() => {
      expect(screen.getByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeInTheDocument();
    });
  });

  it('showThumbnails={false} hides the built-in toggle button but the panel slot stays wired (button-only semantic)', async () => {
    // Sub-contract: hiding the button does NOT remove the panel feature.
    // The outer panel shell must still mount (closed; required for the
    // CSS slide animation). Custom UI exercising the action is verified
    // by the next test ("custom toolbar can open the panel via
    // actions.toggleThumbnails").
    const source = makeSource();
    const { container } = render(<Flipbook source={source} showThumbnails={false} />);
    await waitFor(() => {
      expect(container.querySelector('.fbjs-toolbar__bar--bottom')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: LABELS.thumbnailsToggle })).toBeNull();
    const outer = container.querySelector('.fbjs-thumbnail-panel');
    expect(outer).not.toBeNull();
    expect(outer).toHaveAttribute('data-open', 'false');
    expect(outer).toHaveAttribute('aria-hidden', 'true');
  });

  it('custom UI can open the panel via actions.toggleThumbnails when showThumbnails={false}', async () => {
    // The button-only contract's load-bearing claim: with the built-in
    // toggle hidden via showThumbnails={false}, custom UI can still drive
    // the panel via the public hook. This test mounts a custom toggle via
    // the `children` prop on <Flipbook>, which places the toggle INSIDE
    // the FlipbookProvider context so useFlipbookActions() resolves.
    const source = makeSource();
    function CustomToggle() {
      const actions = useFlipbookActions();
      return (
        <button data-testid="custom-toggle" onClick={() => actions.toggleThumbnails()}>
          Open
        </button>
      );
    }
    const { container } = render(
      <Flipbook source={source} showThumbnails={false}>
        <CustomToggle />
      </Flipbook>,
    );
    // Wait for the custom toggle to appear (proves the provider mounted
    // and rendered children inside provider context).
    const customToggle = await screen.findByTestId('custom-toggle');
    // Panel starts closed.
    const initialOuter = container.querySelector('.fbjs-thumbnail-panel');
    expect(initialOuter).toHaveAttribute('data-open', 'false');
    // Custom UI dispatches the action.
    act(() => { customToggle.click(); });
    // Panel opens — same outer DOM node, data-open flips, aria-hidden
    // removed, inner buttons mount.
    await waitFor(() => {
      expect(container.querySelector('.fbjs-thumbnail-panel')).toHaveAttribute('data-open', 'true');
    });
    const openedOuter = container.querySelector('.fbjs-thumbnail-panel')!;
    expect(openedOuter).toBe(initialOuter);
    expect(openedOuter).not.toHaveAttribute('aria-hidden');
    expect(screen.getAllByRole('button', { name: /Go to page/ })).toHaveLength(4);
  });

  // Source rotation while panel is open.
  it('source rotation while panel is open unmounts old thumbs and mounts new doc thumbs', async () => {
    const sourceA = makeSource(4);
    const sourceB = makeSource(8);
    function App({ src }: { src: PageSource }) { return <Flipbook source={src} />; }
    const { rerender } = render(<App src={sourceA} />);
    const button = await screen.findByRole('button', { name: LABELS.thumbnailsToggle });
    act(() => { button.click(); });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Go to page/ })).toHaveLength(4);
    });
    // Rotate source. usePageSource transitions through 'loading' before
    // 'ready' on the new source — buttons should disappear momentarily,
    // then re-mount for the new doc's pageCount.
    rerender(<App src={sourceB} />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Go to page/ })).toHaveLength(8);
    });
    // thumbnailsOpen state was preserved across SOURCE_CHANGED (panel
    // open-state is not in the reset matrix), so the panel stays open
    // with the new doc's thumbs.
    expect(screen.getByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeInTheDocument();
  });

  // Multi-instance independence: two <Flipbook>s on one page.
  it('two side-by-side <Flipbook> panels maintain independent open state', async () => {
    const sourceA = makeSource(4);
    const sourceB = makeSource(6);
    render(
      <>
        <div data-testid="a"><Flipbook source={sourceA} /></div>
        <div data-testid="b"><Flipbook source={sourceB} /></div>
      </>,
    );
    const aContainer = screen.getByTestId('a');
    const bContainer = screen.getByTestId('b');
    const toggleA = await within(aContainer).findByRole('button', { name: LABELS.thumbnailsToggle });
    const toggleB = await within(bContainer).findByRole('button', { name: LABELS.thumbnailsToggle });

    // Open only A. B unaffected.
    act(() => { toggleA.click(); });
    await waitFor(() => {
      expect(within(aContainer).getByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeInTheDocument();
    });
    // B's outer shell exists (slide-animation contract) but stays
    // closed: data-open="false" + aria-hidden="true". The role="region"
    // query finds it via the accessibility tree, but aria-hidden removes
    // it from the AT tree, so the role query SHOULD NOT find it.
    expect(within(bContainer).queryByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeNull();
    // Sanity check at the DOM level: B's outer shell exists but is closed.
    const bOuter = bContainer.querySelector('.fbjs-thumbnail-panel');
    expect(bOuter).not.toBeNull();
    expect(bOuter).toHaveAttribute('data-open', 'false');

    // Open B too. A's state still open and untouched.
    act(() => { toggleB.click(); });
    await waitFor(() => {
      expect(within(bContainer).getByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeInTheDocument();
    });
    expect(within(aContainer).getByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeInTheDocument();

    // Close A. B stays open.
    act(() => { toggleA.click(); });
    await waitFor(() => {
      expect(within(aContainer).queryByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeNull();
    });
    expect(within(bContainer).getByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeInTheDocument();
  });
});
