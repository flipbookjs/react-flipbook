import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { FlipbookProvider } from '../FlipbookProvider';
import { useFlipbookActions, type FlipbookHookActions } from '../hooks/useFlipbook';
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

function CaptureActions({ ref }: { ref: { current: FlipbookHookActions | null } }) {
  ref.current = useFlipbookActions();
  return null;
}

describe('Theme runtime — .fbjs-root + data-theme', () => {
  it('renders .fbjs-root with data-theme matching initialTheme="dark"; NO tabindex on root', () => {
    const source = makeSource();
    const { container } = render(
      <FlipbookProvider source={source} initialTheme="dark">
        <div />
      </FlipbookProvider>,
    );
    const root = container.querySelector('.fbjs-root');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('data-theme', 'dark');
    // .fbjs-root must NOT carry tabindex — the existing .fbjs-container is the
    // single focusable region with tabindex="0". Two adjacent tabindex="0"
    // elements would create a duplicate tab stop (Decision 4 / KL-not-introduced).
    expect(root).not.toHaveAttribute('tabindex');
    // .fbjs-root must NOT carry an ARIA role — the inner .fbjs-container already
    // declares role="region". Two regions for one logical focus target would be
    // confusing for AT users.
    expect(root).not.toHaveAttribute('role');
  });

  it('default initialTheme produces data-theme="light"', () => {
    const source = makeSource();
    const { container } = render(
      <FlipbookProvider source={source}>
        <div />
      </FlipbookProvider>,
    );
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'light');
  });

  it('setTheme dispatch flips data-theme on the root element', () => {
    const source = makeSource();
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { container } = render(
      <FlipbookProvider source={source} initialTheme="light">
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'light');
    act(() => { actionsRef.current!.setTheme('dark'); });
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'dark');
  });

  it('toggleTheme flips light → dark → light', () => {
    const source = makeSource();
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { container } = render(
      <FlipbookProvider source={source} initialTheme="light">
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'light');
    act(() => { actionsRef.current!.toggleTheme(); });
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'dark');
    act(() => { actionsRef.current!.toggleTheme(); });
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'light');
  });

  it('setTheme with the current value leaves state unchanged (reducer idempotency)', () => {
    const source = makeSource();
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { container } = render(
      <FlipbookProvider source={source} initialTheme="light">
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setTheme('light'); });
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'light');
  });

  it('actions object identity does NOT rotate across theme toggles (themeRef pattern verified)', () => {
    const source = makeSource();
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source} initialTheme="light">
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    const before = actionsRef.current;
    act(() => { actionsRef.current!.toggleTheme(); });
    const after = actionsRef.current;
    // Same actions object identity across the theme change — proves toggleTheme's
    // useCallback deps don't include state.theme (Decision 5 / Phase 3 themeRef).
    expect(after).toBe(before);
  });

  it('source rotation preserves the current theme (theme is NOT source-dependent state)', () => {
    const sourceA = makeSource();
    const sourceB = makeSource();
    const actionsRef = { current: null as FlipbookHookActions | null };
    function App({ src }: { src: PageSource }) {
      return (
        <FlipbookProvider source={src} initialTheme="light">
          <CaptureActions ref={actionsRef} />
        </FlipbookProvider>
      );
    }
    const { container, rerender } = render(<App src={sourceA} />);
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'light');
    act(() => { actionsRef.current!.setTheme('dark'); });
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'dark');
    rerender(<App src={sourceB} />);
    // Provider rebuilds source state but reducer's SOURCE_CHANGED preserves theme
    // (theme is NOT in the reset matrix). UI continues to show dark.
    expect(container.querySelector('.fbjs-root')).toHaveAttribute('data-theme', 'dark');
  });

  it('two side-by-side <Flipbook> providers maintain independent theme state', () => {
    const sourceA = makeSource();
    const sourceB = makeSource();
    const actionsA = { current: null as FlipbookHookActions | null };
    const actionsB = { current: null as FlipbookHookActions | null };
    const { container } = render(
      <>
        <div data-testid="a">
          <FlipbookProvider source={sourceA} initialTheme="light">
            <CaptureActions ref={actionsA} />
          </FlipbookProvider>
        </div>
        <div data-testid="b">
          <FlipbookProvider source={sourceB} initialTheme="dark">
            <CaptureActions ref={actionsB} />
          </FlipbookProvider>
        </div>
      </>,
    );
    const rootA = container.querySelector('[data-testid="a"] .fbjs-root');
    const rootB = container.querySelector('[data-testid="b"] .fbjs-root');
    expect(rootA).toHaveAttribute('data-theme', 'light');
    expect(rootB).toHaveAttribute('data-theme', 'dark');
    // Toggle A — B unchanged.
    act(() => { actionsA.current!.toggleTheme(); });
    expect(rootA).toHaveAttribute('data-theme', 'dark');
    expect(rootB).toHaveAttribute('data-theme', 'dark');
    // Toggle B — A unchanged.
    act(() => { actionsB.current!.toggleTheme(); });
    expect(rootB).toHaveAttribute('data-theme', 'light');
    expect(rootA).toHaveAttribute('data-theme', 'dark');
  });
});
