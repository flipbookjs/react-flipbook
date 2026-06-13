import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import { useFlipbookActions } from '../hooks/useFlipbook';
import type { PageSource } from '../types/PageSource';
import type { ThumbnailPanelProps } from '../thumbnails/ThumbnailPanel';

// ---- Test-suite housekeeping ----
//
// 1. Mock restoration. Tests in this file create `vi.spyOn(console, 'warn')`
//    inline. `afterEach(vi.restoreAllMocks)` prevents the mock from leaking
//    across tests.
afterEach(() => {
  vi.restoreAllMocks();
});

// 2. Shared-state convention for bad-value tests. The resolver's
//    `warnedSizes: Set<unknown>` is module-scoped and persists across `it()`
//    blocks within this file (vitest's `isolate: true` clears between FILES,
//    not between tests in the same file). Each bad-value test must use a
//    value DISTINCT from values used by sibling tests in this file —
//    otherwise the once-per-value dedup from one test silently breaks
//    another test's warn assertion.
//
//    Reserved values:
//      - NaN, Infinity, 0, -50  — used by the it.each sanitization block
//      - 2049, 9999             — used by the clamp test
//      - -77                    — used by the once-per-session test (MED #4)
//      - 400                    — used by the numeric-pass-through test
//
//    Future tests that add bad-value assertions MUST pick fresh values.

// ---- Shared fixture ----

const MOCK_PAGE_WIDTH = 1000;
const MOCK_PAGE_HEIGHT = 1414;
const MOCK_PAGE_COUNT = 3;

const mockReadySource: PageSource = {
  init: async () => {},
  getPageCount: () => MOCK_PAGE_COUNT,
  getPageSize: () => ({ width: MOCK_PAGE_WIDTH, height: MOCK_PAGE_HEIGHT }),
  // renderPage returns an HTMLCanvasElement per the interface. jsdom provides
  // a basic Canvas via document.createElement — size doesn't matter for the
  // width-derivation tests (the panel reads getPageSize, not the canvas).
  renderPage: async () => document.createElement('canvas'),
  dispose: () => {},
};

// Side-channel child that uses the new `children` prop (Phase 5) to dispatch
// `setThumbnailsOpen(true)` from inside provider context. Without this, the
// panel's `[data-page-index]` children never mount (gated on
// `slice.isOpen && slice.status === 'ready'` at ThumbnailPanel.tsx:190-191).
function ThumbnailsOpener() {
  const actions = useFlipbookActions();
  useEffect(() => {
    actions.setThumbnailsOpen(true);
  }, [actions]);
  return null;
}

async function renderWithOpenThumbnails(size: ThumbnailPanelProps['size']) {
  const result = render(
    <Flipbook source={mockReadySource} thumbnailSize={size}>
      <ThumbnailsOpener />
    </Flipbook>,
  );
  await waitFor(() => {
    expect(document.querySelector('[data-page-index="0"]')).not.toBeNull();
  });
  return result;
}

// ---- Tests ----

describe('Flipbook thumbnailSize prop', () => {
  // `data-page-index` and `.fbjs-thumbnail-button` are both attributes on the
  // same <button> element (see ThumbnailButton.tsx:121-126). Use a compound
  // selector, NOT a descendant combinator.
  //
  // mockReadySource fixes pageWidth=1000 / pageHeight=1414 so the omitted-prop
  // case has a deterministic expected width (1000 * 0.2 = 200px).

  it('omitted thumbnailSize preserves 0.1.0-alpha.1 behavior (pageWidth × 0.2)', async () => {
    await renderWithOpenThumbnails(undefined);
    const button = document.querySelector(
      '.fbjs-thumbnail-button[data-page-index="0"]',
    ) as HTMLElement;
    // 1000 * 0.2 = 200
    expect(button).toHaveStyle({ width: '200px' });
  });

  it.each([
    ['small', '360px'],
    ['default', '480px'],
    ['large', '720px'],
  ])('token %s applies inline width %s on .fbjs-thumbnail-button', async (size, expectedCss) => {
    await renderWithOpenThumbnails(size as 'small' | 'default' | 'large');
    const button = document.querySelector(
      '.fbjs-thumbnail-button[data-page-index="0"]',
    ) as HTMLElement;
    expect(button).toHaveStyle({ width: expectedCss });
  });

  it('numeric size passes through to inline width', async () => {
    await renderWithOpenThumbnails(400);
    const button = document.querySelector(
      '.fbjs-thumbnail-button[data-page-index="0"]',
    ) as HTMLElement;
    expect(button).toHaveStyle({ width: '400px' });
  });

  it.each([NaN, Infinity, 0, -50])(
    'invalid numeric size %s falls back to default (480px) with dev-warn',
    async (size) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await renderWithOpenThumbnails(size as number);
      const button = document.querySelector(
        '.fbjs-thumbnail-button[data-page-index="0"]',
      ) as HTMLElement;
      expect(button).toHaveStyle({ width: '480px' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid positive width'));
    },
  );

  it('numeric size above MAX_THUMB_WIDTH clamps to 2048 with dev-warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderWithOpenThumbnails(9999);
    const button = document.querySelector(
      '.fbjs-thumbnail-button[data-page-index="0"]',
    ) as HTMLElement;
    expect(button).toHaveStyle({ width: '2048px' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeds MAX_THUMB_WIDTH'));
  });

  // MED #4: same bad value re-rendered N times → exactly one warn.
  // IMPORTANT: uses a SENTINEL bad value (-77) reserved exclusively for this
  // test. The module-level `warnedSizes` Set persists across `it()` blocks in
  // this file. If this test used NaN / Infinity / 0 / -50, it would interfere
  // with the it.each sanitization tests above.
  it('same invalid value warns once per session (module-level guard)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const SENTINEL_BAD = -77;
    const { rerender } = render(
      <Flipbook source={mockReadySource} thumbnailSize={SENTINEL_BAD}>
        <ThumbnailsOpener />
      </Flipbook>,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-page-index="0"]')).not.toBeNull();
    });
    // Sanity: first render warned for SENTINEL_BAD.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(String(SENTINEL_BAD)));
    const callsAfterFirst = warn.mock.calls.length;
    // Re-render with same sentinel — should NOT add another warn.
    rerender(
      <Flipbook source={mockReadySource} thumbnailSize={SENTINEL_BAD}>
        <ThumbnailsOpener />
      </Flipbook>,
    );
    expect(warn.mock.calls.length).toBe(callsAfterFirst);
  });

  // MED #2: prop change at runtime re-derives dimensions (no stale memo).
  // This test validates that `size` is in the useMemo deps in
  // ThumbnailPanel.tsx — without it the memo returns cached dimensions on
  // re-render and the prop appears non-reactive.
  it('prop change re-derives dimensions on re-render', async () => {
    const { rerender } = render(
      <Flipbook source={mockReadySource} thumbnailSize="small">
        <ThumbnailsOpener />
      </Flipbook>,
    );
    await waitFor(() => {
      expect(document.querySelector('[data-page-index="0"]')).not.toBeNull();
    });
    const before = document.querySelector(
      '.fbjs-thumbnail-button[data-page-index="0"]',
    ) as HTMLElement;
    expect(before).toHaveStyle({ width: '360px' });

    rerender(
      <Flipbook source={mockReadySource} thumbnailSize="large">
        <ThumbnailsOpener />
      </Flipbook>,
    );
    const after = document.querySelector(
      '.fbjs-thumbnail-button[data-page-index="0"]',
    ) as HTMLElement;
    expect(after).toHaveStyle({ width: '720px' });
  });
});
