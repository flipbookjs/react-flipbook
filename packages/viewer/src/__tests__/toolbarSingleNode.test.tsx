import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
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

afterEach(() => {
  vi.restoreAllMocks();
});

// Slot-position assertions use `compareDocumentPosition`. Per W3C: when
// comparing two siblings, the result is exactly `DOCUMENT_POSITION_PRECEDING`
// (=2) or `DOCUMENT_POSITION_FOLLOWING` (=4) — no containment bits mix in.
// The provider renders the toolbar slot nodes raw at FlipbookProvider:1039
// (top) and :1087 (bottom), with `.fbjs-container` between them at :1040-1085.
// Slot markers and `.fbjs-container` are siblings under `.fbjs-root` so the
// strict `.toBe(Node.DOCUMENT_POSITION_FOLLOWING)` assertion is safe.

describe('Flipbook single-ReactNode toolbar position (1.0.0)', () => {
  it('single ReactNode renders in the TOP slot (changed in 1.0.0)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const source = makeSource();
      const { container } = render(
        <Flipbook source={source} toolbar={<span data-testid="tb">T</span>} />,
      );
      await waitFor(() => {
        expect(screen.getByTestId('tb')).toBeInTheDocument();
      });
      const marker = screen.getByTestId('tb');
      const viewport = container.querySelector('.fbjs-container');
      expect(viewport).not.toBeNull();
      // marker comes BEFORE viewport in document order → viewport FOLLOWS marker
      expect(marker.compareDocumentPosition(viewport!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('toolbar={{ bottom }} renders in the bottom slot only', async () => {
    const source = makeSource();
    const { container } = render(
      <Flipbook
        source={source}
        toolbar={{ bottom: <span data-testid="tb">B</span> }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('tb')).toBeInTheDocument();
    });
    const marker = screen.getByTestId('tb');
    const viewport = container.querySelector('.fbjs-container');
    expect(viewport).not.toBeNull();
    // viewport comes BEFORE marker → marker FOLLOWS viewport
    expect(viewport!.compareDocumentPosition(marker)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('toolbar={{ top, bottom }} renders both slots', async () => {
    const source = makeSource();
    const { container } = render(
      <Flipbook
        source={source}
        toolbar={{
          top: <span data-testid="tb-top">T</span>,
          bottom: <span data-testid="tb-bot">B</span>,
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('tb-top')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tb-bot')).toBeInTheDocument();
    const top = screen.getByTestId('tb-top');
    const bottom = screen.getByTestId('tb-bot');
    const viewport = container.querySelector('.fbjs-container');
    expect(viewport).not.toBeNull();
    // top BEFORE viewport, bottom AFTER viewport
    expect(top.compareDocumentPosition(viewport!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(viewport!.compareDocumentPosition(bottom)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('toolbar={{ top }} renders in the top slot only', async () => {
    const source = makeSource();
    const { container } = render(
      <Flipbook
        source={source}
        toolbar={{ top: <span data-testid="tb">T</span> }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('tb')).toBeInTheDocument();
    });
    const marker = screen.getByTestId('tb');
    const viewport = container.querySelector('.fbjs-container');
    expect(viewport).not.toBeNull();
    expect(marker.compareDocumentPosition(viewport!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  // MED #2: prop reshape on re-render. Catches stale slot memoization or
  // accidental once-per-mount-only branching in Flipbook.tsx's dispatch.
  it('reshapes top/bottom slots when toolbar prop changes shape on re-render', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const source = makeSource();
      const { rerender, container } = render(
        <Flipbook source={source} toolbar={<span data-testid="tb-a">A</span>} />,
      );
      await waitFor(() => {
        expect(screen.getByTestId('tb-a')).toBeInTheDocument();
      });
      // 1.0.0 default: single ReactNode → top
      {
        const markerA = screen.getByTestId('tb-a');
        const viewport = container.querySelector('.fbjs-container');
        expect(viewport).not.toBeNull();
        expect(markerA.compareDocumentPosition(viewport!)).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }

      // Reshape: single ReactNode → slot object with bottom only
      rerender(
        <Flipbook
          source={source}
          toolbar={{ bottom: <span data-testid="tb-b">B</span> }}
        />,
      );
      expect(screen.queryByTestId('tb-a')).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('tb-b')).toBeInTheDocument();
      });
      {
        const markerB = screen.getByTestId('tb-b');
        const viewport = container.querySelector('.fbjs-container');
        expect(viewport).not.toBeNull();
        expect(viewport!.compareDocumentPosition(markerB)).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }

      // Reshape back to single ReactNode (top)
      rerender(
        <Flipbook source={source} toolbar={<span data-testid="tb-c">C</span>} />,
      );
      expect(screen.queryByTestId('tb-b')).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('tb-c')).toBeInTheDocument();
      });
      {
        const markerC = screen.getByTestId('tb-c');
        const viewport = container.querySelector('.fbjs-container');
        expect(viewport).not.toBeNull();
        expect(markerC.compareDocumentPosition(viewport!)).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});
