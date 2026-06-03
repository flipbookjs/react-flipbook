import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FlipbookProvider } from '../FlipbookProvider';
import { Toolbar } from '../toolbar/Toolbar';
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

describe('Toolbar — render structure', () => {
  // Note: the SSR / useIsMounted gate is verified by Step 5.7's
  // `flipbookSSR.test.tsx` via `renderToString`. A client-side `render()`
  // call cannot observe the gate because RTL flushes effects via `act`
  // before returning — by the time any synchronous DOM query runs, the
  // post-mount commit has already produced the real output.

  it('after mount, bottom bar renders with LABELS.toolbarBottomBarLabel + nav + zoom + selection/theme', async () => {
    const source = makeSource();
    render(
      <FlipbookProvider source={source}>
        <Toolbar position="bottom" />
      </FlipbookProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: LABELS.toolbarBottomBarLabel })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: LABELS.prevPage })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.nextPage })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.zoomIn })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.zoomOut })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.selectionModeToggle })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.themeToggle })).toBeInTheDocument();
  });

  it('top bar renders with LABELS.toolbarTopBarLabel + title + output buttons (print visible by default)', async () => {
    const source = makeSource();
    render(
      <FlipbookProvider source={source}>
        <Toolbar position="top" title="My Document" />
      </FlipbookProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: LABELS.toolbarTopBarLabel })).toBeInTheDocument();
    });
    expect(screen.getByText('My Document')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LABELS.print })).toBeInTheDocument();
    // canDownload defaults false in 6A; download button absent unless overridden.
    expect(screen.queryByRole('button', { name: LABELS.download })).toBeNull();
  });

  it('compact={true} suppresses top bar; bottom bar still renders', async () => {
    const source = makeSource();
    render(
      <FlipbookProvider source={source}>
        <Toolbar position="top" compact title="Hidden" />
        <Toolbar position="bottom" />
      </FlipbookProvider>,
    );
    // Wait for bottom bar (proves useIsMounted fired for both instances).
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: LABELS.toolbarBottomBarLabel })).toBeInTheDocument();
    });
    // Top bar absent due to compact; title not rendered anywhere.
    expect(screen.queryByRole('toolbar', { name: LABELS.toolbarTopBarLabel })).toBeNull();
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('consumer showPrint={false} hides print even when default would show', async () => {
    const source = makeSource();
    render(
      <FlipbookProvider source={source}>
        <Toolbar position="top" title="Doc" showPrint={false} />
      </FlipbookProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Doc')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: LABELS.print })).toBeNull();
  });

  it('consumer showDownload={true} forces download visible despite canDownload=false default', async () => {
    const source = makeSource();
    render(
      <FlipbookProvider source={source}>
        <Toolbar position="top" title="Doc" showDownload={true} />
      </FlipbookProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: LABELS.download })).toBeInTheDocument();
    });
  });

  it('rendering <Toolbar> outside FlipbookProvider throws (existing useFlipbookSelector contract)', () => {
    // Toolbar calls useFlipbookSelector internally, which throws when no
    // FlipbookProvider is in the ancestry. This test documents the failure
    // mode so a future regression that silently degrades to no-render
    // (e.g., switching to optional chaining + default fallback) is caught.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Toolbar position="bottom" />)).toThrow(/FlipbookProvider/i);
    errorSpy.mockRestore();
  });
});
