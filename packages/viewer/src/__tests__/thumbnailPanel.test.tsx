import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    // viewMode="single" so the leading-page selector gives 1:1 tracking:
    // exactly one thumbnail has aria-current. Dual-cover spread-aware
    // highlighting (via data-current-spread on both pages) is covered by
    // dedicated tests below.
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

  it('dual-cover mode: clicking a right-page thumbnail marks BOTH pages of the spread with data-current-spread', async () => {
    const source = makeSource(6);
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source} viewMode="dual-cover">
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => screen.getByTestId('fbjs-thumbnail-2'));
    // In dual-cover mode with a cover, spread 1 is pages 2-3 (0-indexed: 1-2).
    // Click the right thumbnail (pageIndex=2, page 3).
    act(() => { screen.getByTestId('fbjs-thumbnail-2').click(); });
    await waitFor(() => {
      // Visual affordance covers BOTH pages of the current spread.
      expect(screen.getByTestId('fbjs-thumbnail-1')).toHaveAttribute('data-current-spread', 'true');
      expect(screen.getByTestId('fbjs-thumbnail-2')).toHaveAttribute('data-current-spread', 'true');
    });
    // Adjacent thumbnails outside the spread do NOT.
    expect(screen.getByTestId('fbjs-thumbnail-0')).not.toHaveAttribute('data-current-spread');
    expect(screen.getByTestId('fbjs-thumbnail-3')).not.toHaveAttribute('data-current-spread');
  });

  it('dual-cover mode: aria-current stays canonical — only the leading page has aria-current="page"', async () => {
    const source = makeSource(6);
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source} viewMode="dual-cover">
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => screen.getByTestId('fbjs-thumbnail-2'));
    act(() => { screen.getByTestId('fbjs-thumbnail-2').click(); });
    await waitFor(() => {
      // Leading page (page 2, pageIndex=1) is the ONLY thumbnail with aria-current.
      expect(screen.getByTestId('fbjs-thumbnail-1')).toHaveAttribute('aria-current', 'page');
    });
    // Right page has data-current-spread but NOT aria-current — canonical rule.
    expect(screen.getByTestId('fbjs-thumbnail-2')).not.toHaveAttribute('aria-current');
  });

  it('dual-cover mode: clicking within the current spread preserves focus on the clicked thumbnail', async () => {
    // If the user is already on spread 1 (pages 2-3) and clicks the right
    // thumbnail (page 3), focus stays on the right thumbnail. The layout
    // effect at ThumbnailPanel.tsx:217-219 only re-anchors the roving
    // tabstop when pageNumber CHANGES — clicking within the current spread
    // doesn't change pageNumber (still resolves to the leading page).
    const source = makeSource(6);
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source} viewMode="dual-cover">
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    // Wait for source-ready BEFORE calling goToPage — goToPage is a no-op
    // while status is 'loading' (see FlipbookProvider.tsx:655-663). The
    // presence of a rendered thumbnail is a reliable readiness signal, since
    // ThumbnailPanel only renders buttons post-ready.
    await waitFor(() => screen.getByTestId('fbjs-thumbnail-0'));
    // Navigate to spread 1 (pages 2-3).
    act(() => { actionsRef.current!.goToPage(2); });
    await waitFor(() => {
      expect(screen.getByTestId('fbjs-thumbnail-1')).toHaveAttribute('aria-current', 'page');
    });
    // Now click the right thumbnail of the current spread.
    act(() => { screen.getByTestId('fbjs-thumbnail-2').click(); });
    const rightThumb = screen.getByTestId('fbjs-thumbnail-2');
    // Roving tabstop stays on the clicked (right) thumbnail — NOT re-anchored
    // to the leading page.
    await waitFor(() => {
      expect(rightThumb).toHaveAttribute('tabindex', '0');
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

  // §4 wiring contract: the open panel's inline `max-height` reflects the
  // scroll container's `scrollHeight`. jsdom returns 0 for `scrollHeight`
  // regardless of CSS, and the vitest.setup.ts ResizeObserver polyfill
  // auto-fires on `observe()` — so the first measurement always reads 0.
  // To verify the JS-driven max-height wiring under controlled fakes:
  //   1. Open the panel (scrollRoot mounts, layout effect runs, polyfill
  //      auto-fires with the default contentRect, measure reads scrollHeight=0,
  //      setOpenMaxHeight(0) commits → inline style "0px").
  //   2. Mock the scroll element's `scrollHeight` to a controlled value.
  //   3. Manually re-fire the ResizeObserver callback so `measure()` re-runs
  //      and reads the NEW `scrollHeight`. Wrap in `act()` so React flushes
  //      the resulting `setState` before assertion.
  //   4. Assert the outer panel's inline `maxHeight` reflects the new height.
  // This proves the state-flip + ResizeObserver-driven re-measure pipeline
  // without depending on jsdom doing real flex layout.
  it('open panel applies inline max-height reflecting the scroll container scrollHeight', async () => {
    const source = makeSource(4);
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { container } = render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    // Wait for the scroll container to mount (open-state JSX commits).
    await waitFor(() => {
      expect(container.querySelector('.fbjs-thumbnail-panel__scroll')).not.toBeNull();
    });
    const scrollEl = container.querySelector('.fbjs-thumbnail-panel__scroll') as HTMLElement;
    // Mock `scrollHeight` on the actual scroll element so the next
    // `measure()` reads 400 instead of jsdom's default 0.
    Object.defineProperty(scrollEl, 'scrollHeight', {
      configurable: true,
      value: 400,
    });
    // Manually fire the polyfill's ResizeObserver callback. The polyfill
    // (vitest.setup.ts:48) pushes each instance onto `globalThis.__resizeObservers`
    // in constructor order, and exposes a per-instance `_fireResize(width, height)`
    // helper that re-invokes the user callback. The panel's layout-effect
    // observer is the LAST one registered before this point.
    await act(async () => {
      const observers = (globalThis as unknown as {
        __resizeObservers: Array<{ _fireResize: (w: number, h: number) => void }>;
      }).__resizeObservers;
      const ourObserver = observers[observers.length - 1];
      ourObserver._fireResize(1024, 400);
    });
    const outer = container.querySelector('.fbjs-thumbnail-panel') as HTMLElement;
    expect(outer.style.maxHeight).toBe('400px');
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

// ============================================================================
// §7.2 Container-resize-reflow + mixed-page-size scenarios.
//
// The implementation reads `computed.paddingLeft`, `computed.paddingRight`,
// `computed.columnGap`, and `computed.gap` (as a fallback). jsdom's
// `getComputedStyle` does NOT expand the `padding` shorthand into its
// individual side properties — the mock must populate exactly the longhand
// properties the implementation reads. Similarly jsdom returns 0 for
// `clientWidth` and `scrollHeight` regardless of CSS, so those are mocked
// via `Object.defineProperty` (same pattern as the 1.0.3 `openMaxHeight`
// test above).
// ============================================================================
describe('ThumbnailPanel — container-resize reflow (§7.2)', () => {
  // Mock setup at test scope. Replaces window.getComputedStyle just for the
  // scroll container so the implementation reads padX=24 + gapPx=8 instead
  // of jsdom's empty strings (which would degrade to 0 → wrong expected
  // widths → tests pass for the wrong reason).
  let origGetComputedStyle: typeof window.getComputedStyle;

  beforeEach(() => {
    origGetComputedStyle = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      if ((el as HTMLElement).classList?.contains('fbjs-thumbnail-panel__scroll')) {
        return {
          paddingLeft: '12px',
          paddingRight: '12px',
          columnGap: '8px',
          gap: '8px',
        } as unknown as CSSStyleDeclaration;
      }
      return origGetComputedStyle.call(window, el);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fireLastObserver(width: number, height: number): void {
    const observers = (globalThis as unknown as {
      __resizeObservers: Array<{ _fireResize: (w: number, h: number) => void }>;
    }).__resizeObservers;
    observers[observers.length - 1]._fireResize(width, height);
  }

  it('uniform-page PDF reflows on container resize (1924 → 1024)', async () => {
    // Uniform 612x792 source → median pageWidth = 612 → per-page scale = 1.
    // Comfortable density (target=10), gap=8, padding=24:
    //   clientWidth=1924 → contentWidth=1900 → unitWidth=(1900-72)/10=182.8 → floor 182
    //   clientWidth=1024 → contentWidth=1000 → unitWidth=(1000-72)/10=92.8 → floor 92
    const source = makeSource(4);
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { container } = render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel density="comfortable" />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => {
      expect(container.querySelector('.fbjs-thumbnail-panel__scroll')).not.toBeNull();
    });
    const scrollEl = container.querySelector('.fbjs-thumbnail-panel__scroll') as HTMLElement;

    // Mock clientWidth=1924 and fire the observer so measure() re-runs
    // with the new value. (The first measure ran with clientWidth=0 — that
    // committed a degenerate state; this re-fire is what surfaces the
    // assertable behavior under the jsdom-mock constraints.)
    Object.defineProperty(scrollEl, 'clientWidth', { configurable: true, value: 1924 });
    await act(async () => { fireLastObserver(1924, 0); });

    let thumb0 = container.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(thumb0.style.width).toBe('182px');

    // Resize to clientWidth=1024.
    Object.defineProperty(scrollEl, 'clientWidth', { configurable: true, value: 1024 });
    await act(async () => { fireLastObserver(1024, 0); });

    thumb0 = container.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(thumb0.style.width).toBe('92px');
  });

  it('mixed-page-size PDF preserves per-page widths via true median', async () => {
    // Two-page source: portrait (612x792) and landscape (792x612).
    // True median pageWidth = (612 + 792) / 2 = 702.
    // Comfortable density (target=10), gap=8, clientWidth=1924 → contentWidth=1900:
    //   unitWidth = (1900-72)/10 = 182.8
    //   portrait: 182.8 × (612/702) = 159.4 → floor 159
    //   landscape: 182.8 × (792/702) = 206.3 → floor 206
    const pageSizes = [
      { width: 612, height: 792 },   // portrait
      { width: 792, height: 612 },   // landscape
    ];
    const mixedSource: PageSource = {
      init: () => Promise.resolve(),
      getPageCount: () => pageSizes.length,
      getPageSize: (i) => pageSizes[i],
      renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
      dispose: () => {},
    };
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { container } = render(
      <FlipbookProvider source={mixedSource}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel density="comfortable" />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => {
      expect(container.querySelector('.fbjs-thumbnail-panel__scroll')).not.toBeNull();
    });
    const scrollEl = container.querySelector('.fbjs-thumbnail-panel__scroll') as HTMLElement;

    Object.defineProperty(scrollEl, 'clientWidth', { configurable: true, value: 1924 });
    await act(async () => { fireLastObserver(1924, 0); });

    const portraitThumb = container.querySelector('[data-page-index="0"]') as HTMLElement;
    const landscapeThumb = container.querySelector('[data-page-index="1"]') as HTMLElement;
    expect(portraitThumb.style.width).toBe('159px');
    expect(landscapeThumb.style.width).toBe('206px');
  });

  it('explicit width is forwarded unchanged regardless of container size', async () => {
    const source = makeSource(4);
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { container } = render(
      <FlipbookProvider source={source}>
        <CaptureActions actionsRef={actionsRef} />
        <ThumbnailPanel width={500} />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setThumbnailsOpen(true); });
    await waitFor(() => {
      expect(container.querySelector('.fbjs-thumbnail-panel__scroll')).not.toBeNull();
    });
    const scrollEl = container.querySelector('.fbjs-thumbnail-panel__scroll') as HTMLElement;

    Object.defineProperty(scrollEl, 'clientWidth', { configurable: true, value: 1924 });
    await act(async () => { fireLastObserver(1924, 0); });

    let thumb0 = container.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(thumb0.style.width).toBe('500px');

    // Resize to 320 — explicit width is unaffected by container changes.
    Object.defineProperty(scrollEl, 'clientWidth', { configurable: true, value: 320 });
    await act(async () => { fireLastObserver(320, 0); });

    thumb0 = container.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(thumb0.style.width).toBe('500px');
  });
});
