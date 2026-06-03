import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
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

describe('StrictMode regression — useToolbarPart double-mount safety', () => {
  it('no console errors or warnings during double-mount + remount', async () => {
    const source = makeSource(4);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <StrictMode>
        <FlipbookProvider source={source}>
          <ToolbarShell>
            <PrevButton />
            <NextButton />
            <ZoomInButton />
          </ToolbarShell>
        </FlipbookProvider>
      </StrictMode>,
    );

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    });

    // Allow any deferred warnings to flush
    await vi.waitFor(() => true);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('first part has tabIndex=0 after StrictMode double-invoke (no null flash leaving all parts at -1)', async () => {
    const source = makeSource(4);
    render(
      <StrictMode>
        <FlipbookProvider source={source}>
          <ToolbarShell>
            <PrevButton />
            <NextButton />
            <ZoomInButton />
          </ToolbarShell>
        </FlipbookProvider>
      </StrictMode>,
    );

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    });

    // After StrictMode's mount→unmount→remount, the first part should still
    // have tabIndex=0 (idempotent re-registration via useId + Map.set).
    expect(screen.getByRole('button', { name: /previous page/i })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: /next page/i })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: /zoom in/i })).toHaveAttribute('tabindex', '-1');
  });

  it('a registered part survives the StrictMode unmount/remount without leaking duplicate entries', async () => {
    // We can't directly read partsRef.current.size from outside the shell, but
    // we CAN observe behavior that would change if duplicates existed:
    // ArrowRight cycling should land at exactly the next button (not skip via
    // a duplicate entry that breaks the index lookup).
    const source = makeSource(4);
    const { container: _c } = render(
      <StrictMode>
        <FlipbookProvider source={source}>
          <ToolbarShell>
            <PrevButton />
            <NextButton />
          </ToolbarShell>
        </FlipbookProvider>
      </StrictMode>,
    );
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    });
    const prev = screen.getByRole('button', { name: /previous page/i });
    prev.focus();
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(prev, { key: 'ArrowRight' });
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /next page/i })).toHaveAttribute('tabindex', '0');
    });
    // Cycle again — should wrap back to PrevButton (only 2 parts), not get
    // stuck on a phantom duplicate.
    const next = screen.getByRole('button', { name: /next page/i });
    next.focus();
    fireEvent.keyDown(next, { key: 'ArrowRight' });
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toHaveAttribute('tabindex', '0');
    });
  });
});
