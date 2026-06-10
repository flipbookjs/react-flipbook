import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FlipbookProvider } from '../FlipbookProvider';
import { ThumbnailPanel } from '../thumbnails/ThumbnailPanel';
import { useFlipbookActions, type FlipbookHookActions } from '../hooks/useFlipbook';
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

// `actionsRef` is an ORDINARY prop name (not `ref`). React 18 treats `ref`
// as a reserved prop on function components — passing `<CaptureActions
// ref={...} />` would warn "Function components cannot be given refs" AND
// the destructured `ref` would be undefined. React 19 allows `ref` as a
// regular prop, but the viewer's peer-dep is `react >= 18.0.0`, so the
// tests must work on 18 too. Using a non-reserved name keeps the same
// shape across both major versions.
function CaptureActions({ actionsRef }: { actionsRef: { current: FlipbookHookActions | null } }) {
  actionsRef.current = useFlipbookActions();
  return null;
}

describe('ThumbnailPanel', () => {
  it('default closed state: outer shell mounts with data-open="false" + aria-hidden="true"; no inner content', async () => {
    // Slide-animation contract: the outer `.fbjs-thumbnail-panel` div
    // ALWAYS stays mounted while `<ThumbnailPanel>` itself is mounted
    // (useIsMounted committed), toggling its data-open attribute based
    // on state.thumbnailsOpen. Only the INNER scroll-container +
    // buttons mount conditionally on
    // isOpen. This test pins the initial-mount-closed contract.
    const source = makeSource();
    const { container } = render(
      <FlipbookProvider source={source}>
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    // useIsMounted commits — wait for the outer shell to appear.
    await waitFor(() => {
      expect(container.querySelector('.fbjs-thumbnail-panel')).not.toBeNull();
    });
    const outer = container.querySelector('.fbjs-thumbnail-panel')!;
    expect(outer).toHaveAttribute('data-open', 'false');
    expect(outer).toHaveAttribute('aria-hidden', 'true');
    // Inner content (scroll container + buttons) is NOT mounted while closed.
    expect(container.querySelector('.fbjs-thumbnail-panel__scroll')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /Go to page/ })).toHaveLength(0);
  });

  it('renders region with aria-label when toggled open', async () => {
    const source = makeSource();
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => {
      expect(screen.getByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeInTheDocument();
    });
  });

  it('renders one button per page when open + source ready', async () => {
    const source = makeSource(5);
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /Go to page/ });
      expect(buttons).toHaveLength(5);
    });
  });

  it('current page button has aria-current="page"', async () => {
    const source = makeSource(4);
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source} initialPage={1}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => {
      const current = screen.getByTestId('fbjs-thumbnail-1');
      expect(current).toHaveAttribute('aria-current', 'page');
    });
  });

  it('clicking a thumbnail dispatches goToPage with 1-indexed value', async () => {
    const source = makeSource(4);
    const actionsRef = { current: null as FlipbookHookActions | null };
    // viewMode="single" so pageNumber === pageIndex + 1 (1:1 tracking). In
    // dual-cover mode, KL3's "aria-current on leading page only" means
    // clicking thumb-2 (page 3) lands on spread 1 (pages 1+2) → pageNumber=2
    // → aria-current on thumb-1 instead. This test is about the dispatch
    // contract, not dual-cover spread semantics.
    render(
      <FlipbookProvider source={source} viewMode="single">
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => screen.getByTestId('fbjs-thumbnail-2'));
    act(() => { screen.getByTestId('fbjs-thumbnail-2').click(); });
    // Page 3 (1-indexed: 2 + 1)
    // Verify via aria-current after dispatch.
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-thumbnail-2')).toHaveAttribute('aria-current', 'page');
    });
  });

  it('Arrow Right from thumb 0 dispatches goToPage(2) AND moves focus to thumb 1', async () => {
    const source = makeSource(4);
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => screen.getByTestId('fbjs-thumbnail-0'));
    const thumb0 = screen.getByTestId('fbjs-thumbnail-0');
    act(() => { thumb0.focus(); });
    expect(thumb0).toHaveFocus();
    fireEvent.keyDown(thumb0, { key: 'ArrowRight' });
    const thumb1 = screen.getByTestId('fbjs-thumbnail-1');
    expect(thumb1).toHaveFocus();
    expect(thumb1).toHaveAttribute('aria-current', 'page');
  });

  it('Arrow Left from thumb 0 (boundary) does NOT navigate or move focus', async () => {
    const source = makeSource(4);
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => screen.getByTestId('fbjs-thumbnail-0'));
    const thumb0 = screen.getByTestId('fbjs-thumbnail-0');
    act(() => { thumb0.focus(); });
    fireEvent.keyDown(thumb0, { key: 'ArrowLeft' });
    expect(thumb0).toHaveFocus();
    expect(thumb0).toHaveAttribute('aria-current', 'page');
  });

  it('End key jumps to the last thumbnail; Home key returns to first', async () => {
    const source = makeSource(5);
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => screen.getByTestId('fbjs-thumbnail-0'));
    const thumb0 = screen.getByTestId('fbjs-thumbnail-0');
    act(() => { thumb0.focus(); });
    fireEvent.keyDown(thumb0, { key: 'End' });
    expect(screen.getByTestId('fbjs-thumbnail-4')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('fbjs-thumbnail-4'), { key: 'Home' });
    expect(screen.getByTestId('fbjs-thumbnail-0')).toHaveFocus();
  });

  // Tab-into-panel WAI-ARIA composite-widget contract.
  it('Tab into panel lands on the active button (current page), not the first thumb', async () => {
    const source = makeSource(5);
    const actionsRef = { current: null as FlipbookHookActions | null };
    // viewMode="single" + initialPage={2} (0-indexed) → pageNumber=3 →
    // pageIndex 2 → thumb-2 is the active tabstop. In dual-cover mode
    // pageNumber=3 isn't reachable (pageIndex 2 is the right side of
    // spread 1, leading to pageNumber=2 instead).
    render(
      <FlipbookProvider source={source} viewMode="single" initialPage={2}>
        <CaptureActions actionsRef={actionsRef} />
        <button data-testid="before">Before</button>
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => screen.getByTestId('fbjs-thumbnail-2'));
    const before = screen.getByTestId('before');
    act(() => { before.focus(); });
    expect(before).toHaveFocus();
    // The only tabIndex=0 inside the panel is thumb 2 (pageNumber 3,
    // pageIndex 2). Simulate a Tab — JSDOM does NOT natively move focus
    // on synthetic Tab events, so we verify the contract by asserting
    // ONLY one panel button is tabbable; native browser Tab landing on
    // it is implied by tabIndex=0.
    const tabbableThumbs = screen
      .getAllByRole('button', { name: /Go to page/ })
      .filter((b) => b.getAttribute('tabIndex') === '0');
    expect(tabbableThumbs).toHaveLength(1);
    expect(tabbableThumbs[0]).toBe(screen.getByTestId('fbjs-thumbnail-2'));
  });

  // Empty-document edge case.
  it('panel handles pageCount=0 without rendering buttons (renders empty region shell)', async () => {
    const source = makeSource(0);
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => {
      expect(screen.getByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeInTheDocument();
    });
    expect(screen.queryAllByRole('button', { name: /Go to page/ })).toHaveLength(0);
  });

  // Slide-animation contract: outer shell stays in DOM when closed.
  // Required so the CSS max-height transition has an element to animate
  // against on close → open and open → close. Returning null on close
  // would silently kill the animation. Regression-pin.
  it('outer shell remains in DOM when closed (slide-animation contract)', async () => {
    const source = makeSource(4);
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { container } = render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    // Wait for useIsMounted to commit — outer shell mounts even at initial
    // closed state (this IS the contract: closed-state shell exists from
    // mount onward so the first open transition has a "from" state).
    await waitFor(() => {
      expect(container.querySelector('.fbjs-thumbnail-panel')).not.toBeNull();
    });
    const initialOuter = container.querySelector('.fbjs-thumbnail-panel')!;
    expect(initialOuter).toHaveAttribute('data-open', 'false');
    expect(initialOuter).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryAllByRole('button', { name: /Go to page/ })).toHaveLength(0);

    // Open: same outer element, data-open flips true, aria-hidden removed,
    // inner buttons mount.
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Go to page/ })).toHaveLength(4);
    });
    const openOuter = container.querySelector('.fbjs-thumbnail-panel')!;
    expect(openOuter).toBe(initialOuter);   // SAME DOM node — required for CSS transition
    expect(openOuter).toHaveAttribute('data-open', 'true');
    expect(openOuter).not.toHaveAttribute('aria-hidden');

    // Close: outer persists, data-open flips false, aria-hidden returns,
    // inner buttons unmount (canvas memory released).
    act(() => { actionsRef.current!.setThumbnailsOpen(false); });
    await waitFor(() => {
      expect(screen.queryAllByRole('button', { name: /Go to page/ })).toHaveLength(0);
    });
    const closedOuter = container.querySelector('.fbjs-thumbnail-panel')!;
    expect(closedOuter).toBe(initialOuter);   // SAME DOM node across the whole open/close cycle
    expect(closedOuter).toHaveAttribute('data-open', 'false');
    expect(closedOuter).toHaveAttribute('aria-hidden', 'true');
  });
});
