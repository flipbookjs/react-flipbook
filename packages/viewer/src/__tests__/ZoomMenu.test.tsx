// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { FlipbookProvider } from '../FlipbookProvider';
import { ToolbarShell } from '../toolbar/ToolbarShell';
import { ZoomMenu } from '../toolbar/ZoomMenu';
import { useFlipbookActions, type FlipbookHookActions } from '../hooks/useFlipbook';
import { LABELS } from '../toolbar/labels';
import { SpecialZoomLevel } from '../zoom/SpecialZoomLevel';
import type { PageSource } from '../types/PageSource';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

function makeNeverReadySource(): PageSource {
  return {
    init: () => new Promise(() => {}),  // never resolves → status stays 'loading'
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

// Captures the live `actions` object from inside the provider so tests can
// install spies via vi.spyOn. ZoomMenu reads the SAME object reference via
// useFlipbookActions (Object.is selector on a useMemo'd actions object in
// FlipbookProvider), so mutating one method here is observed by ZoomMenu.
let capturedActions: FlipbookHookActions | undefined;
function ActionCapture() {
  capturedActions = useFlipbookActions();
  return null;
}

function Wrapper({ children, source }: { children: ReactNode; source: PageSource }) {
  return (
    <FlipbookProvider source={source}>
      <ActionCapture />
      <ToolbarShell>{children}</ToolbarShell>
    </FlipbookProvider>
  );
}

// Renders the given UI inside the standard Wrapper and waits for the source to
// reach status='ready' (signalled by aria-disabled='true' falling off the
// trigger). Returns the render result.
async function renderReady(ui: ReactNode, triggerTestId = 'fbjs-zoom-menu-trigger') {
  const source = makeSource();
  const result = render(<Wrapper source={source}>{ui}</Wrapper>);
  await waitFor(() => {
    expect(screen.getByTestId(triggerTestId)).not.toHaveAttribute('aria-disabled', 'true');
  });
  return result;
}

beforeEach(() => {
  capturedActions = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('ZoomMenu', () => {
  it('1. trigger renders the current zoom percent', async () => {
    await renderReady(<ZoomMenu />);
    // Pin scale to a known value — jsdom's measured container otherwise yields
    // a non-100% effectiveScale via the fit-page derivation in FlipbookProvider.
    await act(async () => {
      capturedActions!.setZoom(1);
    });
    expect(screen.getByTestId('fbjs-zoom-menu-trigger')).toHaveTextContent('100%');
  });

  it('2. clicking "Actual size" dispatches setZoom(SpecialZoomLevel.ActualSize)', async () => {
    await renderReady(<ZoomMenu />);
    const setZoomSpy = vi.spyOn(capturedActions!, 'setZoom');
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-trigger'));
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-item-actualSize'));
    expect(setZoomSpy).toHaveBeenCalledWith(SpecialZoomLevel.ActualSize);
  });

  it('3. clicking "Page fit" dispatches fitPage()', async () => {
    await renderReady(<ZoomMenu />);
    const fitPageSpy = vi.spyOn(capturedActions!, 'fitPage');
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-trigger'));
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-item-pageFit'));
    expect(fitPageSpy).toHaveBeenCalled();
  });

  it('4. clicking "Page width" dispatches fitWidth()', async () => {
    await renderReady(<ZoomMenu />);
    const fitWidthSpy = vi.spyOn(capturedActions!, 'fitWidth');
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-trigger'));
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-item-pageWidth'));
    expect(fitWidthSpy).toHaveBeenCalled();
  });

  it('5. clicking "200%" dispatches setZoom(2)', async () => {
    await renderReady(<ZoomMenu />);
    const setZoomSpy = vi.spyOn(capturedActions!, 'setZoom');
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-trigger'));
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-item-p200'));
    expect(setZoomSpy).toHaveBeenCalledWith(2);
  });

  it('6. at customScale=1, both "Actual size" and "100%" show check icons; only "Actual size" has aria-current', async () => {
    await renderReady(<ZoomMenu />);
    // Default state is zoomMode='fit-page'. Switch to custom + customScale=1
    // so BOTH "Actual size" and "100%" entries match isCurrent.
    await act(async () => {
      capturedActions!.setZoom(SpecialZoomLevel.ActualSize);
    });
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-trigger'));
    const actualItem = screen.getByTestId('fbjs-zoom-menu-item-actualSize');
    const p100Item = screen.getByTestId('fbjs-zoom-menu-item-p100');
    // Canonical-current rule: first isCurrent in array order gets aria-current.
    expect(actualItem).toHaveAttribute('aria-current', 'true');
    expect(p100Item).not.toHaveAttribute('aria-current');
    // Both matching items render the visible check icon (svg inside the check span).
    expect(actualItem.querySelector('.fbjs-toolbar__menu-item-check svg')).not.toBeNull();
    expect(p100Item.querySelector('.fbjs-toolbar__menu-item-check svg')).not.toBeNull();
  });

  it('7. zoomMode="fit-page" → "Page fit" has aria-current', async () => {
    await renderReady(<ZoomMenu />);
    // Default zoomMode is 'fit-page' — assert directly without dispatching.
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-trigger'));
    expect(screen.getByTestId('fbjs-zoom-menu-item-pageFit'))
      .toHaveAttribute('aria-current', 'true');
  });

  it('8. customScale=0.87 → trigger reads 87%; no item has aria-current', async () => {
    await renderReady(<ZoomMenu />);
    await act(async () => {
      capturedActions!.setZoom(0.87);
    });
    expect(screen.getByTestId('fbjs-zoom-menu-trigger')).toHaveTextContent('87%');
    fireEvent.click(screen.getByTestId('fbjs-zoom-menu-trigger'));
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(0);
    items.forEach((item) => {
      expect(item).not.toHaveAttribute('aria-current');
    });
  });

  it('9. live region announces zoom with verbose context (not the bare percent)', async () => {
    await renderReady(<ZoomMenu />);
    // Pin scale to a known value so the verbose-form assertion below is
    // independent of jsdom's measured container size.
    await act(async () => {
      capturedActions!.setZoom(1);
    });
    const live = screen.getByTestId('fbjs-zoom-menu-readout-live');
    // Live region content matches LABELS.zoomMenuTriggerLabel(percent), preserving
    // the "Zoom level: X%" announcement quality the prior ZoomReadout's aria-label
    // had — screen readers get full context on every change, not just digits.
    expect(live).toHaveTextContent(LABELS.zoomMenuTriggerLabel(100));
    expect(live).toHaveTextContent('Zoom menu, current level 100%');
  });

  it('10. disabled when status !== "ready" → trigger has aria-disabled="true"', () => {
    const source = makeNeverReadySource();
    render(<Wrapper source={source}><ZoomMenu /></Wrapper>);
    expect(screen.getByTestId('fbjs-zoom-menu-trigger'))
      .toHaveAttribute('aria-disabled', 'true');
  });

  it('11. default trigger testid is "fbjs-zoom-menu-trigger"', async () => {
    await renderReady(<ZoomMenu />);
    expect(screen.getByTestId('fbjs-zoom-menu-trigger')).toBeInTheDocument();
  });

  it('12. custom data-testid cascades to trigger, popover, items, and live region', async () => {
    await renderReady(<ZoomMenu data-testid="my-zoom" />, 'my-zoom-trigger');
    expect(screen.getByTestId('my-zoom-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('my-zoom-readout-live')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('my-zoom-trigger'));
    expect(screen.getByTestId('my-zoom-popover')).toBeInTheDocument();
    expect(screen.getByTestId('my-zoom-item-actualSize')).toBeInTheDocument();
  });

  it('13. two instances emit fully-distinct testids (multi-instance safe)', async () => {
    const source = makeSource();
    render(
      <Wrapper source={source}>
        <ZoomMenu data-testid="zoom-a" />
        <ZoomMenu data-testid="zoom-b" />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('zoom-a-trigger')).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(screen.getByTestId('zoom-a-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-b-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-a-readout-live')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-b-readout-live')).toBeInTheDocument();
    // Opening instance A's popover must not surface instance B's popover.
    fireEvent.click(screen.getByTestId('zoom-a-trigger'));
    expect(screen.getByTestId('zoom-a-popover')).toBeInTheDocument();
    expect(screen.queryByTestId('zoom-b-popover')).toBeNull();
  });
});
