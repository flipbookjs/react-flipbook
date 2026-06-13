import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import { useFlipbook } from '../hooks/useFlipbook';
import type { FlipbookHookState } from '../hooks/useFlipbook';
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

// State-capture side channel mounted via the `children` prop (Phase 5). The
// hook resolves the provider context because the child renders inside the
// provider scope at FlipbookProvider.tsx:1089.
function StateCapture({ stateRef }: { stateRef: { current: FlipbookHookState | null } }) {
  const hook = useFlipbook();
  stateRef.current = hook.state;
  return null;
}

describe('Flipbook initialInteractionMode prop', () => {
  it('seeds state.interactionMode from initialInteractionMode prop on first render', async () => {
    const stateRef = { current: null as FlipbookHookState | null };
    render(
      <Flipbook source={makeSource()} initialInteractionMode="pan">
        <StateCapture stateRef={stateRef} />
      </Flipbook>,
    );
    await waitFor(() => {
      expect(stateRef.current).not.toBeNull();
    });
    expect(stateRef.current!.interactionMode).toBe('pan');
  });

  it("defaults to 'select' when initialInteractionMode is omitted", async () => {
    const stateRef = { current: null as FlipbookHookState | null };
    render(
      <Flipbook source={makeSource()}>
        <StateCapture stateRef={stateRef} />
      </Flipbook>,
    );
    await waitFor(() => {
      expect(stateRef.current).not.toBeNull();
    });
    expect(stateRef.current!.interactionMode).toBe('select');
  });

  it("explicitly passing 'select' yields state.interactionMode === 'select'", async () => {
    const stateRef = { current: null as FlipbookHookState | null };
    render(
      <Flipbook source={makeSource()} initialInteractionMode="select">
        <StateCapture stateRef={stateRef} />
      </Flipbook>,
    );
    await waitFor(() => {
      expect(stateRef.current).not.toBeNull();
    });
    expect(stateRef.current!.interactionMode).toBe('select');
  });

  // Uncontrolled-prop contract: prop changes after mount are ignored.
  // Matches the initialTheme pattern (FlipbookProvider.tsx:253 — read once
  // in the lazy useReducer initializer).
  it('post-mount prop changes are ignored (uncontrolled, matches initialTheme)', async () => {
    const stateRef = { current: null as FlipbookHookState | null };
    const { rerender } = render(
      <Flipbook source={makeSource()} initialInteractionMode="pan">
        <StateCapture stateRef={stateRef} />
      </Flipbook>,
    );
    await waitFor(() => {
      expect(stateRef.current).not.toBeNull();
    });
    expect(stateRef.current!.interactionMode).toBe('pan');

    // Change the prop after mount — state should NOT update.
    rerender(
      <Flipbook source={makeSource()} initialInteractionMode="select">
        <StateCapture stateRef={stateRef} />
      </Flipbook>,
    );
    expect(stateRef.current!.interactionMode).toBe('pan');
  });
});
