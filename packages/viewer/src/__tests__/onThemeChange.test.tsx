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

describe('onThemeChange callback semantics', () => {
  it('does NOT fire on initial seed (mount-only path)', () => {
    const source = makeSource();
    const cb = vi.fn();
    render(
      <FlipbookProvider source={source} initialTheme="dark" onThemeChange={cb}>
        <div />
      </FlipbookProvider>,
    );
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires synchronously on setTheme with the new theme as argument', () => {
    const source = makeSource();
    const cb = vi.fn();
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source} initialTheme="light" onThemeChange={cb}>
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setTheme('dark'); });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('dark');
  });

  it('fires on toggleTheme with the new (toggled) theme', () => {
    const source = makeSource();
    const cb = vi.fn();
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source} initialTheme="light" onThemeChange={cb}>
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.toggleTheme(); });
    expect(cb).toHaveBeenLastCalledWith('dark');
    act(() => { actionsRef.current!.toggleTheme(); });
    expect(cb).toHaveBeenLastCalledWith('light');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('ref-mirror: re-render with a new callback identity uses the new callback on next dispatch', () => {
    const source = makeSource();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const actionsRef = { current: null as FlipbookHookActions | null };
    const { rerender } = render(
      <FlipbookProvider source={source} initialTheme="light" onThemeChange={cb1}>
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    rerender(
      <FlipbookProvider source={source} initialTheme="light" onThemeChange={cb2}>
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setTheme('dark'); });
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledWith('dark');
  });

  it('fires per CALL, not per TRANSITION — setTheme with current value still invokes the callback', () => {
    // Documented contract: onThemeChange fires after every successful action body
    // dispatch, regardless of whether the reducer actually changed state. Consumers
    // wanting transition-only semantics should compare prev vs new inside their callback.
    const source = makeSource();
    const cb = vi.fn();
    const actionsRef = { current: null as FlipbookHookActions | null };
    render(
      <FlipbookProvider source={source} initialTheme="light" onThemeChange={cb}>
        <CaptureActions ref={actionsRef} />
      </FlipbookProvider>,
    );
    act(() => { actionsRef.current!.setTheme('light'); });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('light');
  });
});
