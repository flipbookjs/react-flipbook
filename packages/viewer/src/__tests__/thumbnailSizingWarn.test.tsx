import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import { ThumbnailPanel } from '../thumbnails/ThumbnailPanel';
import { FlipbookProvider } from '../FlipbookProvider';
import type { PageSource } from '../types/PageSource';

// Runtime both-supplied dev-warn tests for the 2.0 thumbnail-sizing surface.
// TypeScript's discriminated union prevents typed callers from supplying both
// `thumbnailDensity` AND `thumbnailWidth` (Flipbook) or both `density` AND
// `width` (ThumbnailPanel) — see `thumbnailSizing.types.tsx`. This file
// covers the JS-side bypass: an untyped caller, or a typed caller that
// casts through `any` / `@ts-ignore`, should hit a once-per-process
// dev-warn at the prop boundary.
//
// JSX `@ts-expect-error` caveat: putting `{/* @ts-expect-error */}` inside
// JSX children is a NO-OP for the TypeScript checker — it parses as a JSX
// expression container with a JS comment inside, and the directive never
// reaches the type checker. The robust pattern (used below) is to spread a
// cast-to-any props object. This survives JSX nesting and avoids the
// "unused @ts-expect-error" failure mode when a TS upgrade incidentally
// fixes the underlying error type.
//
// Dedup interaction: the two warn flags (`warnedFlipbookBothSupplied` in
// Flipbook.tsx and `warnedPanelBothSupplied` in ThumbnailPanel.tsx) are
// independent module-level singletons. Each test triggers a different flag,
// so the two tests don't interfere with each other. Within a single test,
// the warn fires exactly once on first invocation — that's what we assert.

afterEach(() => {
  vi.restoreAllMocks();
});

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

describe('Both-supplied dev-warn — surface-specific messages', () => {
  it('Flipbook surface: both thumbnailDensity + thumbnailWidth → warn names FLIPBOOK prop names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Spread-cast bypass of the discriminated union to simulate a JS-side
    // caller that passes both props. The cast-to-any happens at the props
    // object level so the directive applies to a top-level expression
    // (NOT inside a JSX expression container — that's the JSX no-op
    // failure mode the file header documents).
    const bothProps = { thumbnailDensity: 'comfortable', thumbnailWidth: 400 } as unknown as Record<string, unknown>;
    render(<Flipbook source={makeSource()} {...bothProps} />);
    // Filter to the both-supplied warn (the toolbar / source warns from
    // other code paths in Flipbook may add extra unrelated calls).
    const matching = warn.mock.calls
      .map((args) => String(args[0]))
      .filter((msg) =>
        msg.includes('Flipbook') &&
        msg.includes('thumbnailDensity') &&
        msg.includes('thumbnailWidth'),
      );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toContain('thumbnailWidth wins');
    // Negative-pin: the message must NOT use the panel-surface phrasing.
    expect(matching[0]).not.toContain('density and width are supplied');
  });

  it('ThumbnailPanel surface: both density + width → warn names PANEL prop names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bothProps = { density: 'comfortable', width: 400 } as unknown as Record<string, unknown>;
    render(
      <FlipbookProvider source={makeSource()}>
        <ThumbnailPanel {...bothProps} />
      </FlipbookProvider>,
    );
    const matching = warn.mock.calls
      .map((args) => String(args[0]))
      .filter((msg) => msg.includes('ThumbnailPanel') && msg.includes('density and width'));
    expect(matching).toHaveLength(1);
    expect(matching[0]).toContain('width wins');
    // Negative-pin: must NOT use the Flipbook prefixed names.
    expect(matching[0]).not.toContain('thumbnailDensity');
    expect(matching[0]).not.toContain('thumbnailWidth');
  });
});
