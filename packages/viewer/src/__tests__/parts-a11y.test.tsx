import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { FlipbookProvider } from '../FlipbookProvider';
import { ToolbarShell } from '../toolbar/ToolbarShell';
import { PrevButton } from '../toolbar/buttons/PrevButton';
import { NextButton } from '../toolbar/buttons/NextButton';
import { ZoomInButton } from '../toolbar/buttons/ZoomInButton';
import { ZoomOutButton } from '../toolbar/buttons/ZoomOutButton';
import { FullScreenButton } from '../toolbar/buttons/FullScreenButton';
import { PrintButton } from '../toolbar/buttons/PrintButton';
import { DownloadButton } from '../toolbar/buttons/DownloadButton';
import { SelectionModeButton } from '../toolbar/buttons/SelectionModeButton';
import { ThemeToggleButton } from '../toolbar/buttons/ThemeToggleButton';
import { PageReadout } from '../toolbar/readouts/PageReadout';
import { ZoomMenu } from '../toolbar/ZoomMenu';
import type { PageSource } from '../types/PageSource';

expect.extend(toHaveNoViolations);

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

function FullToolbar() {
  return (
    <ToolbarShell>
      <PrevButton />
      <NextButton />
      <PageReadout />
      <ZoomOutButton />
      <ZoomMenu />
      <ZoomInButton />
      <FullScreenButton />
      <PrintButton />
      <DownloadButton />
      <SelectionModeButton />
      <ThemeToggleButton />
    </ToolbarShell>
  );
}

describe('Toolbar parts — automated a11y audit (jest-axe)', () => {
  // Scope axe to the toolbar element so unrelated FlipbookProvider chrome
  // (e.g., its loading-state `<div class="fbjs-loading" aria-label="...">`,
  // an existing 6A pattern that triggers axe's aria-prohibited-attr rule)
  // doesn't false-positive these toolbar-specific audits. The test names
  // describe toolbar invariants; the scoping preserves that intent.
  it('full toolbar in loading state has zero ARIA violations', async () => {
    const source = makeSource();
    const { container } = render(
      <FlipbookProvider source={source}>
        <FullToolbar />
      </FlipbookProvider>,
    );
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const results = await axe(toolbar);
    expect(results).toHaveNoViolations();
  });

  it('full toolbar after source-ready has zero ARIA violations', async () => {
    const source = makeSource();
    const { container } = render(
      <FlipbookProvider source={source}>
        <FullToolbar />
      </FlipbookProvider>,
    );
    // Let source.init() + SOURCE_CHANGED settle. PrevButton's disabled
    // selector still returns true at spread 0; NextButton flips to enabled.
    // Wait until NextButton is no longer aria-disabled.
    await vi.waitFor(() => {
      const next = container.querySelector('[data-testid="fbjs-next-button"]');
      expect(next).not.toHaveAttribute('aria-disabled');
    });
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const results = await axe(toolbar);
    expect(results).toHaveNoViolations();
  });

  it('individual toggle buttons declare aria-pressed correctly', async () => {
    const source = makeSource();
    const { container } = render(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <FullScreenButton />
          <SelectionModeButton />
          <ThemeToggleButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const results = await axe(toolbar);
    expect(results).toHaveNoViolations();
    // Direct attribute check: toggle buttons must have aria-pressed.
    const fullscreen = container.querySelector('[data-testid="fbjs-fullscreen-button"]');
    const selection = container.querySelector('[data-testid="fbjs-selection-mode-button"]');
    const theme = container.querySelector('[data-testid="fbjs-theme-toggle-button"]');
    expect(fullscreen).toHaveAttribute('aria-pressed');
    expect(selection).toHaveAttribute('aria-pressed');
    expect(theme).toHaveAttribute('aria-pressed');
  });

  it('readouts use role="status" without redundant aria-live', async () => {
    const source = makeSource();
    const { container } = render(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PageReadout />
          <ZoomMenu />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const results = await axe(toolbar);
    expect(results).toHaveNoViolations();
    // Direct verification: role="status" is present, aria-live is NOT (role
    // implies aria-live=polite per ARIA spec; explicit attribute would be
    // redundant).
    const page = container.querySelector('[data-testid="fbjs-page-readout"]');
    const zoom = container.querySelector('[data-testid="fbjs-zoom-menu-readout-live"]');
    expect(page).toHaveAttribute('role', 'status');
    expect(page).not.toHaveAttribute('aria-live');
    expect(zoom).toHaveAttribute('role', 'status');
    expect(zoom).not.toHaveAttribute('aria-live');
  });

  it('shell announces role="toolbar" with aria-label', async () => {
    const source = makeSource();
    const { container } = render(
      <FlipbookProvider source={source}>
        <ToolbarShell><PrevButton /></ToolbarShell>
      </FlipbookProvider>,
    );
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const results = await axe(toolbar);
    expect(results).toHaveNoViolations();
    expect(toolbar).toHaveAttribute('aria-label');
  });
});
