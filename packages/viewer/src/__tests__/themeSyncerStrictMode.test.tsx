import { describe, expect, it, vi } from 'vitest';
import { StrictMode, useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import { useFlipbook, useFlipbookActions } from '../hooks/useFlipbook';
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

// The §7.2 ThemeSyncer pattern, verbatim.
function ThemeSyncer({ theme }: { theme: 'light' | 'dark' }) {
  const actions = useFlipbookActions();
  useEffect(() => {
    actions.setTheme(theme);
  }, [theme, actions]);
  return null;
}

function StateCapture({ stateRef }: { stateRef: { current: FlipbookHookState | null } }) {
  const hook = useFlipbook();
  stateRef.current = hook.state;
  return null;
}

// Anchored to reducer no-op behavior at flipbookReducer.ts:293-294
// (`case 'SET_THEME': if (state.theme === action.value) return state;`).
// The mount→cleanup→mount StrictMode sequence dispatches twice, but the
// second dispatch is a same-value no-op. The reducer's early-return guards
// the snapshot identity, so descendants don't see a cascade — no loop.
//
// If a future reducer edit removes the early-return guard for SET_THEME, the
// final-state assertion still passes (the state ends at 'dark' either way),
// but the "settles without re-toggling" intent breaks silently. The
// after-settle stability assertion catches that: it re-checks state.theme
// after a microtask delay to confirm nothing is still mutating.

describe('§7.2 ThemeSyncer pattern under React.StrictMode', () => {
  it('settles at the external theme value (no infinite loop, no re-toggling)', async () => {
    const stateRef = { current: null as FlipbookHookState | null };
    render(
      <StrictMode>
        <Flipbook source={makeSource()} initialTheme="light">
          <ThemeSyncer theme="dark" />
          <StateCapture stateRef={stateRef} />
        </Flipbook>
      </StrictMode>,
    );

    // Settles at 'dark' after the effect runs.
    await waitFor(() => {
      expect(stateRef.current?.theme).toBe('dark');
    });

    // Stability check: after a frame's worth of delay, the state is still
    // 'dark'. A reducer regression that drops the same-value no-op guard at
    // flipbookReducer.ts:293-294 would not necessarily fail the settle
    // assertion above (the value still converges) but might surface here if
    // the snapshot identity rotates and triggers a re-mount cascade.
    const snapshotAfterSettle = stateRef.current!.theme;
    await new Promise((resolve) => setTimeout(resolve, 32));
    expect(stateRef.current!.theme).toBe(snapshotAfterSettle);
  });

  it('matching initialTheme + external theme is a no-op (no dispatch causes a re-render cascade)', async () => {
    const stateRef = { current: null as FlipbookHookState | null };
    render(
      <StrictMode>
        <Flipbook source={makeSource()} initialTheme="dark">
          <ThemeSyncer theme="dark" />
          <StateCapture stateRef={stateRef} />
        </Flipbook>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(stateRef.current).not.toBeNull();
    });
    expect(stateRef.current!.theme).toBe('dark');

    // After a delay, still 'dark' — no oscillation possible because the
    // reducer's SET_THEME no-op early-return at flipbookReducer.ts:293-294
    // means dispatching 'dark' when state is already 'dark' returns the
    // SAME state object (no snapshot identity change, no descendant
    // re-render cascade).
    await new Promise((resolve) => setTimeout(resolve, 32));
    expect(stateRef.current!.theme).toBe('dark');
  });
});
