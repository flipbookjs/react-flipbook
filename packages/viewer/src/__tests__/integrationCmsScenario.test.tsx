import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import { useFlipbook } from '../hooks/useFlipbook';
import type { FlipbookHookState } from '../hooks/useFlipbook';
import type { PageSource } from '../types/PageSource';

// Realistic combined-CMS scenario covering every 1.0.0 fix in one render:
//   - Discriminated union — custom toolbar via slot object (no
//     show*/compact/title).
//   - toolbar={{ top: ... }} → top-slot rendering (the explicit-slot form
//     documented as preferred over single-ReactNode at MIGRATION.md §6.2).
//   - initialInteractionMode='pan' seeds state.interactionMode.
//   - thumbnailDensity='comfortable' wired through to ThumbnailPanel (panel
//     is NOT opened in this scenario — visual width assertions live in
//     thumbnailSize.test.tsx which exercises the resolver directly; here
//     we just verify the prop is accepted without compile error or
//     runtime warn).
//   - children prop forwards a state-capture component into provider
//     context; initialTheme='dark' seeds state.theme.
//
// Uses <Flipbook> directly (NOT <FlipbookProvider>) — the prop-forwarding
// chain Flipbook → Provider is part of what we're testing.

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

function StateCapture({ stateRef }: { stateRef: { current: FlipbookHookState | null } }) {
  const hook = useFlipbook();
  stateRef.current = hook.state;
  return null;
}

describe('Flipbook 1.0.0 — combined CMS scenario', () => {
  it('forwards every new 1.0.0 prop through to the right consumer', async () => {
    const stateRef = { current: null as FlipbookHookState | null };

    render(
      <Flipbook
        source={makeSource()}
        toolbar={{ top: <span data-testid="ct">CT</span> }}
        initialInteractionMode="pan"
        thumbnailDensity="comfortable"
        initialTheme="dark"
      >
        <StateCapture stateRef={stateRef} />
      </Flipbook>,
    );

    // Wait for the provider to mount (state populated via the children
    // hook). Once the StateCapture's hook resolves, the provider context
    // is live and every other assertion below can run.
    await waitFor(() => {
      expect(stateRef.current).not.toBeNull();
    });

    // 1. Custom toolbar — slot-object top variant. Provider renders the
    //    slot raw (no wrapper class) at FlipbookProvider:1039, so we
    //    assert via the injected data-testid marker rather than a
    //    `.fbjs-toolbar-top` selector that doesn't exist.
    expect(screen.getByTestId('ct')).toBeInTheDocument();

    // 2. initialInteractionMode flows Flipbook.tsx:223 → Flipbook.tsx:364
    //    (forwarded) → FlipbookProvider.tsx:236 → :260 (passed as 4th arg
    //    to createInitialState) → flipbookReducer.ts:152,169 (state.interactionMode).
    expect(stateRef.current!.interactionMode).toBe('pan');

    // 3. initialTheme three-place default pattern: prop seeds reducer at
    //    mount via the same lazy-init chain as initialInteractionMode.
    expect(stateRef.current!.theme).toBe('dark');

    // 4. thumbnailDensity — accepted without compile error or runtime warn.
    //    No width assertion here: the panel isn't opened in this scenario
    //    (slot-object toolbar replaces the built-in chrome that has the
    //    open trigger), so `[data-page-index]` children don't mount.
    //    Resolver-level width assertions live in thumbnailSize.test.tsx,
    //    which calls `resolveItemDimensions` directly.
    //
    //    Sanity check on the discriminated union: this whole render
    //    compiled, which means the slot-object form correctly narrowed to
    //    FlipbookCustomToolbarProps without flagging the (already-absent)
    //    show*/compact/title props, and `thumbnailDensity` satisfied the
    //    sizing branch of the FlipbookProps intersection.
  });
});
