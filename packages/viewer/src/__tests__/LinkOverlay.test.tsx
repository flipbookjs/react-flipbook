// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { LinkOverlay } from '../components/LinkOverlay';
import type { PageSource, LinkAnnotation } from '../types/PageSource';

afterEach(cleanup);

function mockSource(
  links: LinkAnnotation[] = [],
  overrides: Partial<PageSource> = {},
): PageSource {
  return {
    init: vi.fn(() => Promise.resolve()),
    getPageCount: vi.fn(() => 1),
    getPageSize: vi.fn(() => ({ width: 612, height: 792 })),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: vi.fn(),
    getLinks: vi.fn(() => Promise.resolve(links)),
    ...overrides,
  };
}

describe('LinkOverlay', () => {
  it('renders one hit target per link with scaled position', async () => {
    const source = mockSource([
      { rect: [10, 20, 30, 40], url: 'https://a.example' },
      { rect: [50, 60, 70, 80], destPage: 4 },
      { rect: [90, 100, 110, 120], url: 'https://b.example' },
    ]);
    render(
      <LinkOverlay
        source={source} pageIndex={0} scale={2}
        onInternalLinkClick={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('fbjs-link')).toHaveLength(3);
    });
    const first = screen.getAllByTestId('fbjs-link')[0];
    const style = first.getAttribute('style') ?? '';
    expect(style).toContain('left: 20px');    // 10 * 2
    expect(style).toContain('top: 40px');     // 20 * 2
    expect(style).toContain('width: 40px');   // (30-10) * 2
    expect(style).toContain('height: 40px');  // (40-20) * 2
  });

  it('external link is <a target="_blank" rel="noopener noreferrer"> with aria-label', async () => {
    const source = mockSource([
      { rect: [0, 0, 10, 10], url: 'https://example.com' },
    ]);
    render(
      <LinkOverlay
        source={source} pageIndex={0} scale={1}
        onInternalLinkClick={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId('fbjs-link'));
    const el = screen.getByTestId('fbjs-link') as HTMLAnchorElement;
    expect(el.tagName).toBe('A');
    expect(el.href).toBe('https://example.com/');
    expect(el.target).toBe('_blank');
    expect(el.rel).toBe('noopener noreferrer');
    expect(el.getAttribute('aria-label')).toBe('Open link: https://example.com');
  });

  it('internal link click invokes onInternalLinkClick(destPage)', async () => {
    const mockClick = vi.fn();
    const source = mockSource([
      { rect: [0, 0, 10, 10], destPage: 7 },
    ]);
    render(
      <LinkOverlay
        source={source} pageIndex={0} scale={1}
        onInternalLinkClick={mockClick}
      />,
    );
    await waitFor(() => screen.getByTestId('fbjs-link'));
    (screen.getByTestId('fbjs-link') as HTMLButtonElement).click();
    expect(mockClick).toHaveBeenCalledWith(7);
  });

  it('renders nothing when source.getLinks is undefined', () => {
    const source = mockSource([], { getLinks: undefined });
    const { container } = render(
      <LinkOverlay
        source={source} pageIndex={0} scale={1}
        onInternalLinkClick={() => {}}
      />,
    );
    expect(container.querySelector('.fbjs-link-overlay')).toBeNull();
  });

  it('drops malformed rects and negative/non-integer destPage values', async () => {
    // Defensive normalization: any upstream source (third-party impl,
    // old sidecar) that hands us structurally-broken LinkAnnotations
    // must NOT produce broken DOM.
    const source = mockSource([
      { rect: [NaN, 0, 10, 10] as any, url: 'https://a.example' },
      { rect: [0, 0, 10, 10] as any, url: 'https://b.example' },  // valid → keep
      { rect: [5, 5, 5, 5] as any, url: 'https://c.example' },    // zero area
      { rect: [0, 0, 10, 10] as any, destPage: -1 },              // negative
      { rect: [0, 0, 10, 10] as any, destPage: 2.5 },             // non-integer
      { rect: 'oops' as any, destPage: 4 },                       // non-array rect
      { rect: [0, 0, 10, 10] as any, destPage: 7 },               // valid → keep
    ]);
    render(
      <LinkOverlay
        source={source} pageIndex={0} scale={1}
        onInternalLinkClick={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId('fbjs-link'));
    const rendered = screen.getAllByTestId('fbjs-link');
    expect(rendered).toHaveLength(2);
    // Order preserved: b.example (index 1 in input) then destPage: 7 (index 6).
    expect((rendered[0] as HTMLAnchorElement).href).toBe('https://b.example/');
    expect(rendered[1].tagName).toBe('BUTTON');
    expect(rendered[1].getAttribute('aria-label')).toBe('Go to page 8');
  });

  it('drops javascript:/data:/vbscript:/file: URLs at the render fence', async () => {
    // Even if an upstream source hands us a dangerous URL (buggy third-party
    // adapter, or a sidecar baked before api-adapter@1.6.0), LinkOverlay
    // MUST NOT render it as an anchor.
    const source = mockSource([
      { rect: [0, 0, 10, 10], url: 'javascript:alert(1)' },
      { rect: [20, 20, 30, 30], url: 'data:text/html,<script>alert(1)</script>' },
      { rect: [40, 40, 50, 50], url: 'vbscript:msgbox' },
      { rect: [60, 60, 70, 70], url: 'file:///etc/passwd' },
      { rect: [80, 80, 90, 90], url: 'https://example.com' },  // safe — keep
    ]);
    render(
      <LinkOverlay
        source={source} pageIndex={0} scale={1}
        onInternalLinkClick={() => {}}
      />,
    );
    await waitFor(() => screen.getAllByTestId('fbjs-link'));
    const rendered = screen.getAllByTestId('fbjs-link');
    expect(rendered).toHaveLength(1);
    expect((rendered[0] as HTMLAnchorElement).href).toBe('https://example.com/');
  });

  it('clears state with dev warn when a third-party getLinks throws non-AbortError', async () => {
    // Simulates a third-party PageSource impl whose getLinks throws OUTSIDE
    // its own try/catch. LinkOverlay must NOT crash the parent — it clears
    // links to [] and emits a distinctive dev warn so a "no links appear"
    // report is diagnosable without patching the consumer's source.
    const source = mockSource([], {
      getLinks: vi.fn(() => Promise.reject(new Error('third-party fault'))),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <LinkOverlay
        source={source} pageIndex={3} scale={1}
        onInternalLinkClick={() => {}}
      />,
    );
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('LinkOverlay: source.getLinks(3) rejected'),
      );
    });
    expect(container.querySelector('.fbjs-link-overlay')).toBeNull();
    warnSpy.mockRestore();
  });

  it('aborts the getLinks controller on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    const source = mockSource([], {
      getLinks: vi.fn((_i: number, sig?: AbortSignal): Promise<LinkAnnotation[]> => {
        capturedSignal = sig;
        return new Promise<LinkAnnotation[]>(() => {}); // never resolves
      }),
    });
    const { unmount } = render(
      <LinkOverlay
        source={source} pageIndex={0} scale={1}
        onInternalLinkClick={() => {}}
      />,
    );
    // Give the effect a microtask to fire (the promise from getLinks starts pending).
    await Promise.resolve();
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
