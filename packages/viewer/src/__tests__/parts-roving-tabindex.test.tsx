import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FlipbookProvider } from '../FlipbookProvider';
import { ToolbarShell } from '../toolbar/ToolbarShell';
import { PrevButton } from '../toolbar/buttons/PrevButton';
import { NextButton } from '../toolbar/buttons/NextButton';
import { ZoomInButton } from '../toolbar/buttons/ZoomInButton';
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

describe('Roving tabindex — built-in parts inside ToolbarShell', () => {
  it('initial: first part has tabIndex=0, rest have -1', async () => {
    const source = makeSource(4);
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <NextButton />
          <ZoomInButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    // Wait for the parts to render after source init resolves
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /previous page/i })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: /next page/i })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: /zoom in/i })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight from first cycles to second', async () => {
    const source = makeSource(4);
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <NextButton />
          <ZoomInButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    });
    const prev = screen.getByRole('button', { name: /previous page/i });
    prev.focus();
    fireEvent.keyDown(prev, { key: 'ArrowRight' });
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /next page/i })).toHaveAttribute('tabindex', '0');
    });
    expect(screen.getByRole('button', { name: /previous page/i })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowLeft from first wraps to last', async () => {
    const source = makeSource(4);
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <NextButton />
          <ZoomInButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    });
    const prev = screen.getByRole('button', { name: /previous page/i });
    prev.focus();
    fireEvent.keyDown(prev, { key: 'ArrowLeft' });
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /zoom in/i })).toHaveAttribute('tabindex', '0');
    });
  });

  it('Home from middle jumps to first', async () => {
    const source = makeSource(4);
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <NextButton />
          <ZoomInButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
    });
    const next = screen.getByRole('button', { name: /next page/i });
    next.focus();
    fireEvent.keyDown(next, { key: 'Home' });
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toHaveAttribute('tabindex', '0');
    });
  });

  it('End from first jumps to last', async () => {
    const source = makeSource(4);
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <NextButton />
          <ZoomInButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    });
    const prev = screen.getByRole('button', { name: /previous page/i });
    prev.focus();
    fireEvent.keyDown(prev, { key: 'End' });
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /zoom in/i })).toHaveAttribute('tabindex', '0');
    });
  });

  it('a consumer button NOT calling useToolbarPart is skipped by arrow-key cycling but reachable via Tab', async () => {
    const source = makeSource(4);
    render(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <button type="button" aria-label="Consumer extra">Extra</button>
          <NextButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    });
    // The consumer button has no tabIndex from useToolbarPart — it's just a
    // regular <button> with default tabindex (0, since no explicit setting).
    // It's reachable via Tab. ArrowRight from PrevButton goes to NextButton
    // (skips the consumer button) because the consumer button never registered.
    const prev = screen.getByRole('button', { name: /previous page/i });
    prev.focus();
    fireEvent.keyDown(prev, { key: 'ArrowRight' });
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /next page/i })).toHaveAttribute('tabindex', '0');
    });
  });
});
