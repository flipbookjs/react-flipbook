import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { Flipbook } from '../Flipbook';
import { FlipbookProvider } from '../FlipbookProvider';
import { useFlipbookActions, type FlipbookHookActions } from '../hooks/useFlipbook';
import { resolveToolbarVisibility } from '../toolbar/resolveToolbarVisibility';
import type { PageSource } from '../types/PageSource';

// Stub source — 612 × 792 page, 6 pages, async-resolved init.
function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 6,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

// StubResizeObserver factory — verbatim shape from FlipbookProvider.curl.test.tsx:20-39
// but parameterized for the dimensions a given test needs. Small dimensions
// (200 × 200) combined with `defaultScale={2}` produce isOverflowing=true at
// initial mount, the mechanism shared by tests #4 + #6.
function makeStubResizeObserverClass(width: number, height: number) {
  return class StubResizeObserver {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.callback = cb; }
    observe(target: Element): void {
      setTimeout(() => {
        this.callback(
          [{
            target,
            contentRect: new DOMRect(0, 0, width, height),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }, 0);
    }
    unobserve(): void {}
    disconnect(): void {}
  };
}

// Save originals at module scope so afterEach can restore. JSDOM 29 lacks
// setPointerCapture/releasePointerCapture (verified in Phase 0 Step 0.10).
const originalResizeObserver = globalThis.ResizeObserver;
const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
const originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
  HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
  vi.restoreAllMocks();
});

describe('Flipbook selection mode — end-to-end', () => {
  it('1. Default render shows the selection-mode button', async () => {
    const source = makeSource();
    const { queryByTestId } = render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(queryByTestId('fbjs-selection-mode-button')).not.toBeNull();
    });
  });

  it('2. Click button toggles data-fbjs-interaction-mode on the container', async () => {
    const source = makeSource();
    const { container, queryByTestId } = render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(queryByTestId('fbjs-selection-mode-button')).not.toBeNull();
    });
    // Wait for source ready so the button isn't aria-disabled.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="fbjs-ready"]')).not.toBeNull();
    });
    const button = queryByTestId('fbjs-selection-mode-button') as HTMLButtonElement;
    const containerDiv = container.querySelector('.fbjs-container') as HTMLDivElement;
    expect(containerDiv.getAttribute('data-fbjs-interaction-mode')).toBeNull();

    fireEvent.click(button);
    await waitFor(() => {
      expect(containerDiv.getAttribute('data-fbjs-interaction-mode')).toBe('pan');
    });

    fireEvent.click(button);
    await waitFor(() => {
      expect(containerDiv.getAttribute('data-fbjs-interaction-mode')).toBeNull();
    });
  });

  it('3. <Flipbook enablePageCurl> at fit-page → button visible but aria-disabled (curl-coordination)', async () => {
    // Small container so the page fits at default fit-page scale → isOverflowing=false.
    globalThis.ResizeObserver = makeStubResizeObserverClass(200, 200) as unknown as typeof ResizeObserver;
    const source = makeSource();
    const { container, queryByTestId } = render(<Flipbook source={source} enablePageCurl />);

    // Wait for toolbar to render (any toolbar button serves as a signal).
    await waitFor(() => {
      expect(container.querySelector('.fbjs-toolbar')).not.toBeNull();
    });

    // Button is VISIBLE — no more hiding/placeholder.
    const button = queryByTestId('fbjs-selection-mode-button') as HTMLButtonElement;
    expect(button).not.toBeNull();

    // Curl coordination renders the button aria-disabled so pan can't be
    // toggled (would be a no-op without overflow anyway).
    await waitFor(() => {
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    // No placeholder DOM exists anymore.
    expect(container.querySelector('[data-fbjs-placeholder="selection-mode"]')).toBeNull();
  });

  it('4. <Flipbook enablePageCurl> with overflow → button enabled', async () => {
    // 200 × 200 container + defaultScale={2} → page rendered at 1224 × 1584 → isOverflowing=true.
    globalThis.ResizeObserver = makeStubResizeObserverClass(200, 200) as unknown as typeof ResizeObserver;
    const source = makeSource();
    const { queryByTestId } = render(<Flipbook source={source} enablePageCurl defaultScale={2} />);

    // Once the RO callback fires and the provider re-derives isOverflowing=true,
    // the curl-aware resolver flips selectionModeDisabled back to false and the
    // button becomes interactive again.
    await waitFor(() => {
      const button = queryByTestId('fbjs-selection-mode-button') as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      expect(button!.getAttribute('aria-disabled')).toBeNull();
    }, { timeout: 2000 });
  });

  it('5. Programmatic action call works without toolbar mediation', async () => {
    const source = makeSource();
    let capturedActions: FlipbookHookActions | null = null;
    function Dispatcher() {
      const actions = useFlipbookActions();
      useEffect(() => { capturedActions = actions; }, [actions]);
      return null;
    }

    const { container } = render(
      <FlipbookProvider source={source}>
        <Dispatcher />
      </FlipbookProvider>,
    );

    await waitFor(() => {
      expect(capturedActions).not.toBeNull();
    });

    const containerDiv = container.querySelector('.fbjs-container') as HTMLDivElement;
    expect(containerDiv.getAttribute('data-fbjs-interaction-mode')).toBeNull();

    act(() => {
      capturedActions!.setInteractionMode('pan');
    });
    await waitFor(() => {
      expect(containerDiv.getAttribute('data-fbjs-interaction-mode')).toBe('pan');
    });

    act(() => {
      capturedActions!.setInteractionMode('select');
    });
    await waitFor(() => {
      expect(containerDiv.getAttribute('data-fbjs-interaction-mode')).toBeNull();
    });
  });

  it('6. Pan + dormant curl coexistence — pointer events bubble from .fbjs-stage to container (D4)', async () => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    globalThis.ResizeObserver = makeStubResizeObserverClass(200, 200) as unknown as typeof ResizeObserver;
    const source = makeSource();

    const { container, queryByTestId } = render(
      <Flipbook source={source} enablePageCurl defaultScale={2} />,
    );

    // Wait for ready (source loaded) + overflow (button visible).
    await waitFor(() => {
      expect(container.querySelector('[data-testid="fbjs-ready"]')).not.toBeNull();
      expect(queryByTestId('fbjs-selection-mode-button')).not.toBeNull();
    }, { timeout: 2000 });

    const button = queryByTestId('fbjs-selection-mode-button') as HTMLButtonElement;
    const containerDiv = container.querySelector('.fbjs-container') as HTMLDivElement;
    const stage = container.querySelector('.fbjs-stage') as HTMLDivElement;
    expect(stage).not.toBeNull();

    // Toggle to pan mode.
    fireEvent.click(button);
    await waitFor(() => {
      expect(containerDiv.getAttribute('data-fbjs-interaction-mode')).toBe('pan');
    });

    // Pre-set scrollLeft so we can verify the drag delta is applied to the container.
    containerDiv.scrollLeft = 100;

    // Dispatch pointerdown / threshold-crossing pointermove / pointerup on the stage
    // — events bubble naturally up to the container's onPointer* handlers. D4
    // invariant: pan claims these events because curl is dormant (curl's gate
    // fails on !isOverflowing) AND because pan handlers do NOT inspect e.target.
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 70, clientY: 50 });

    expect(containerDiv.scrollLeft).toBe(80); // 100 - 20 = 80
    expect(containerDiv.getAttribute('data-fbjs-panning')).toBe('true');

    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 70, clientY: 50 });
    await waitFor(() => {
      expect(containerDiv.getAttribute('data-fbjs-panning')).toBeNull();
    });
  });
});

describe('resolveToolbarVisibility — curl-coordination disabled flag', () => {
  it('7. selectionModeDisabled=true when enablePageCurl=true AND !isOverflowing', () => {
    const result = resolveToolbarVisibility(
      { showSelectionMode: true, enablePageCurl: true },
      { canDownload: false, canFullScreen: false, isOverflowing: false, printError: null },
    );
    // Button still visible (no hide), but flagged for disabled rendering.
    expect(result.showSelectionMode).toBe(true);
    expect(result.selectionModeDisabled).toBe(true);
  });

  it('8. selectionModeDisabled=false when overflow disengages curl', () => {
    const result = resolveToolbarVisibility(
      { showSelectionMode: true, enablePageCurl: true },
      { canDownload: false, canFullScreen: false, isOverflowing: true, printError: null },
    );
    expect(result.showSelectionMode).toBe(true);
    expect(result.selectionModeDisabled).toBe(false);
  });
});
