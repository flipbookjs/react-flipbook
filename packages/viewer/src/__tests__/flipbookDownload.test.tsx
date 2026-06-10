// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent, cleanup } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import { FlipbookProvider } from '../FlipbookProvider';
import { PdfjsSource } from '../adapters/PdfjsSource';
import { useFlipbookActions, type FlipbookHookActions } from '../hooks/useFlipbook';
import type { PageSource } from '../types/PageSource';

vi.mock('../adapters/PdfjsSource', () => ({
  PdfjsSource: vi.fn(function (this: PageSource, url: string | URL | Uint8Array) {
    Object.assign(this, createMockSource({ url }));
  }),
}));
vi.mock('../adapters/configurePdfWorker', () => ({ configurePdfWorker: vi.fn() }));

function createMockSource(opts: {
  url: string | URL | Uint8Array;
  overrides?: Partial<PageSource>;
}): PageSource {
  return {
    init: vi.fn(() => Promise.resolve()),
    getPageCount: vi.fn(() => 1),
    getPageSize: vi.fn(() => ({ width: 612, height: 792 })),
    getSourceUrl: vi.fn(() => {
      if (typeof opts.url === 'string') return opts.url;
      if (opts.url instanceof URL) return opts.url.toString();
      return undefined;
    }),
    renderPage: vi.fn(() => {
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 100;
      return Promise.resolve(c);
    }),
    dispose: vi.fn(),
    ...opts.overrides,
  };
}

function CaptureActions({ ref }: { ref: { current: FlipbookHookActions | null } }) {
  ref.current = useFlipbookActions();
  return null;
}

function getDownloadButton(): HTMLButtonElement | null {
  return document.querySelector('[data-testid="fbjs-download-button"]');
}

let clickedAnchor: HTMLAnchorElement | undefined;

beforeEach(() => {
  clickedAnchor = undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- prototype-method spy needs `this` to identify the anchor instance that fired
    clickedAnchor = this;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Flipbook download end-to-end', () => {
  // 1
  it('canDownload true for PdfjsSource(URL) → DownloadButton enabled', async () => {
    render(<Flipbook source={new PdfjsSource('/doc.pdf')} />);
    await waitFor(() => expect(getDownloadButton()).not.toBeNull());
    await waitFor(() => expect(getDownloadButton()!.getAttribute('aria-disabled')).not.toBe('true'));
  });

  // 2
  // Tests #2 + #3 pass `showDownload={true}` because the default
  // `props.showDownload ?? slice.canDownload` hides the button when
  // canDownload=false (see Problem Statement: consumer-visible default flip).
  // To assert aria-disabled='true' we need the button rendered, so force-show.
  it('canDownload false for PdfjsSource(Uint8Array) → DownloadButton disabled', async () => {
    render(<Flipbook source={new PdfjsSource(new Uint8Array([0x25, 0x50, 0x44, 0x46]))} showDownload />);
    await waitFor(() => expect(getDownloadButton()).not.toBeNull());
    expect(getDownloadButton()!.getAttribute('aria-disabled')).toBe('true');
  });

  // 3
  it('canDownload false for custom source without getSourceUrl → DownloadButton disabled', async () => {
    const sourceWithoutGetSourceUrl: PageSource = {
      init: () => Promise.resolve(),
      getPageCount: () => 1,
      getPageSize: () => ({ width: 612, height: 792 }),
      renderPage: () => Promise.resolve(document.createElement('canvas')),
      dispose: () => {},
    };
    render(<Flipbook source={sourceWithoutGetSourceUrl} showDownload />);
    await waitFor(() => expect(getDownloadButton()).not.toBeNull());
    expect(getDownloadButton()!.getAttribute('aria-disabled')).toBe('true');
  });

  // 4
  it('click → URL basename as filename (tier-2 fallback) + cross-origin attrs set', async () => {
    render(<Flipbook source={new PdfjsSource('/docs/awesome.pdf')} />);
    await waitFor(() => expect(getDownloadButton()).not.toBeNull());
    const button = getDownloadButton()!;
    await waitFor(() => expect(button.getAttribute('aria-disabled')).not.toBe('true'));
    await act(async () => { fireEvent.click(button); });
    expect(clickedAnchor).toBeDefined();
    expect(clickedAnchor!.href).toMatch(/\/docs\/awesome\.pdf$/);
    expect(clickedAnchor!.download).toBe('awesome.pdf');
    expect(clickedAnchor!.target).toBe('_blank');
    expect(clickedAnchor!.rel).toBe('noopener');
  });

  // 5
  it('documentName overrides URL basename (tier-1 wins)', async () => {
    render(<Flipbook source={new PdfjsSource('/x.pdf')} documentName="My Custom Doc" />);
    await waitFor(() => expect(getDownloadButton()).not.toBeNull());
    const button = getDownloadButton()!;
    await waitFor(() => expect(button.getAttribute('aria-disabled')).not.toBe('true'));
    await act(async () => { fireEvent.click(button); });
    expect(clickedAnchor!.download).toBe('My Custom Doc.pdf');
  });

  // 6a — KL8 decode behavior: percent-encoded characters in URL pathname
  // basename are URL-decoded before being used as the filename. Without
  // decoding, the literal `%` in `a.download` gets re-encoded by the
  // browser when saving (e.g., `LDEO%20Annual` becomes `LDEO%2520Annual`
  // on disk). Decoding produces clean, human-readable filenames.
  it('URL-encoded basename is decoded so the saved filename has clean characters', async () => {
    render(<Flipbook source={new PdfjsSource('/LDEO%20Annual%20Report%202021.pdf')} />);
    await waitFor(() => expect(getDownloadButton()).not.toBeNull());
    const button = getDownloadButton()!;
    await waitFor(() => expect(button.getAttribute('aria-disabled')).not.toBe('true'));
    await act(async () => { fireEvent.click(button); });
    expect(clickedAnchor!.download).toBe('LDEO Annual Report 2021.pdf');
  });

  // 6
  it('URL with query string uses pathname basename, NOT query (KL8)', async () => {
    render(<Flipbook source={new PdfjsSource('/api/pdf?id=123')} />);
    await waitFor(() => expect(getDownloadButton()).not.toBeNull());
    const button = getDownloadButton()!;
    await waitFor(() => expect(button.getAttribute('aria-disabled')).not.toBe('true'));
    await act(async () => { fireEvent.click(button); });
    expect(clickedAnchor!.download).toBe('pdf.pdf');
  });

  // 7
  it('no-URL programmatic call → devWarn + no anchor click (undefined + empty-string symmetry)', () => {
    // Sub-case A: source without getSourceUrl (returns undefined via optional chain).
    const sourceUndefined: PageSource = {
      init: () => Promise.resolve(),
      getPageCount: () => 1,
      getPageSize: () => ({ width: 612, height: 792 }),
      renderPage: () => Promise.resolve(document.createElement('canvas')),
      dispose: () => {},
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const actionsRefA = { current: null as FlipbookHookActions | null };
    const { unmount } = render(
      <FlipbookProvider source={sourceUndefined}>
        <CaptureActions ref={actionsRefA} />
      </FlipbookProvider>,
    );
    act(() => { actionsRefA.current!.download(); });
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls.at(-1)?.[0] ?? '')).toContain('No-op');
    expect(clickedAnchor).toBeUndefined();
    unmount();
    warnSpy.mockClear();

    // Sub-case B: source.getSourceUrl returns '' (empty string).
    // Symmetric with `canDownload = !!source.getSourceUrl?.()` — both
    // disable-state and action must treat empty-string URL as "no URL".
    const sourceEmpty: PageSource = {
      init: () => Promise.resolve(),
      getPageCount: () => 1,
      getPageSize: () => ({ width: 612, height: 792 }),
      getSourceUrl: () => '',
      renderPage: () => Promise.resolve(document.createElement('canvas')),
      dispose: () => {},
    };
    const actionsRefB = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={sourceEmpty}>
        <CaptureActions ref={actionsRefB} />
      </FlipbookProvider>,
    );
    act(() => { actionsRefB.current!.download(); });
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls.at(-1)?.[0] ?? '')).toContain('No-op');
    expect(clickedAnchor).toBeUndefined();
  });

  // 8
  // documentName rerender does NOT rotate actions.download identity; the
  // ref-mirror serves the LATEST documentName value on the next call.
  //
  // Implementation note: <Flipbook> doesn't expose `children`, so this test
  // uses <FlipbookProvider> directly with CaptureActions (the established
  // codebase pattern for capturing actions in tests; see onThemeChange.test.tsx).
  // The plan's "click the button" is semantically equivalent to calling
  // actions.download() programmatically — the button's onClick handler does
  // exactly that internally via composeHandlers. The load-bearing assertion
  // (filename === 'Second.pdf') verifies the ref-mirror pattern regardless.
  //
  // Relies on RTL's rerender() synchronously flushing layout effects so the
  // documentNameRef has the new value before download() is called. True under
  // React 18 + the project's current RTL. If RTL changes its flushing
  // semantics, wrap the download() call in `await waitFor(...)`.
  it('documentName rerender does NOT rotate actions.download identity; ref-mirror serves latest value', () => {
    const source = new PdfjsSource('/doc.pdf');
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { rerender } = render(
      <FlipbookProvider source={source} documentName="First">
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    const download1 = actionsRef.current!.download;
    rerender(
      <FlipbookProvider source={source} documentName="Second">
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    const download2 = actionsRef.current!.download;
    // Object.is — same function reference proves the action's [source] deps
    // didn't rotate when documentName changed.
    expect(download1).toBe(download2);
    act(() => { download2(); });
    expect(clickedAnchor).toBeDefined();
    expect(clickedAnchor!.download).toBe('Second.pdf');
  });
});
