import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ToolbarShell } from '../toolbar/ToolbarShell';
import { ThumbnailsToggleButton } from '../toolbar/buttons/ThumbnailsToggleButton';
import { FlipbookProvider } from '../FlipbookProvider';
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

describe('ThumbnailsToggleButton', () => {
  it('renders with default aria-label + aria-pressed=false initially', () => {
    const source = makeSource();
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell><ThumbnailsToggleButton /></ToolbarShell>
      </FlipbookProvider>,
    );
    const button = screen.getByRole('button', { name: LABELS.thumbnailsToggle });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('click toggles aria-pressed + aria-expanded to true', () => {
    const source = makeSource();
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell><ThumbnailsToggleButton /></ToolbarShell>
      </FlipbookProvider>,
    );
    const button = screen.getByRole('button', { name: LABELS.thumbnailsToggle });
    act(() => { button.click(); });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('second click toggles back to false', () => {
    const source = makeSource();
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell><ThumbnailsToggleButton /></ToolbarShell>
      </FlipbookProvider>,
    );
    const button = screen.getByRole('button', { name: LABELS.thumbnailsToggle });
    act(() => { button.click(); });
    act(() => { button.click(); });
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('consumer-passed aria-label overrides default', () => {
    const source = makeSource();
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell><ThumbnailsToggleButton aria-label="My custom label" /></ToolbarShell>
      </FlipbookProvider>,
    );
    expect(screen.getByRole('button', { name: 'My custom label' })).toBeInTheDocument();
  });
});
