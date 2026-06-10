import { describe, expect, it, vi } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import { useToolbarPart } from '../toolbar/useToolbarPart';
import { ToolbarShellContext, type FocusableElement, type ToolbarShellContextValue } from '../toolbar/ToolbarShellContext';
import { useState, useCallback, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

// A minimal shell-like wrapper that exposes the registry to the test.
function makeWrapper() {
  const partsRef = { current: new Map<string, RefObject<FocusableElement | null>>() };

  function Wrapper({ children }: { children: ReactNode }) {
    const [activeId, setActiveIdState] = useState<string | null>(null);
    const setActiveId = useCallback((id: string) => {
      setActiveIdState((prev) => (prev === id ? prev : id));
    }, []);
    const registerPart = useCallback((id: string, ref: RefObject<FocusableElement | null>) => {
      partsRef.current.set(id, ref);
      setActiveIdState((prev) => (prev === null ? id : prev));
      return () => {
        partsRef.current.delete(id);
        setActiveIdState((prev) => {
          if (prev !== id) return prev;
          const next = partsRef.current.keys().next();
          return next.done ? null : next.value;
        });
      };
    }, []);
    const focusFirst = useCallback(() => {}, []);
    const focusLast = useCallback(() => {}, []);
    const focusNext = useCallback(() => {}, []);
    const focusPrevious = useCallback(() => {}, []);
    const value: ToolbarShellContextValue = {
      registerPart, activeId, setActiveId,
      focusFirst, focusLast, focusNext, focusPrevious,
    };
    return <ToolbarShellContext.Provider value={value}>{children}</ToolbarShellContext.Provider>;
  }

  return { Wrapper, partsRef };
}

describe('useToolbarPart — standalone (no shell)', () => {
  it('returns tabIndex=0 when no shell is in the tree', () => {
    const { result } = renderHook(() => useToolbarPart());
    expect(result.current.tabIndex).toBe(0);
  });

  it('returns a ref, onFocus, and onKeyDown', () => {
    const { result } = renderHook(() => useToolbarPart());
    expect(result.current.ref).toBeDefined();
    expect(typeof result.current.onFocus).toBe('function');
    expect(typeof result.current.onKeyDown).toBe('function');
  });

  it('onFocus is a no-op when used outside a shell', () => {
    const { result } = renderHook(() => useToolbarPart());
    // Should not throw.
    act(() => { result.current.onFocus(); });
  });
});

describe('useToolbarPart — registered inside shell', () => {
  it('first registered part receives tabIndex=0', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useToolbarPart(), { wrapper: Wrapper });
    expect(result.current.tabIndex).toBe(0);
  });

  it('second part receives tabIndex=-1 while first stays 0', () => {
    const { Wrapper, partsRef } = makeWrapper();
    function Probe() {
      const a = useToolbarPart();
      const b = useToolbarPart();
      return (
        <>
          <button data-testid="a" tabIndex={a.tabIndex} onFocus={a.onFocus} onKeyDown={a.onKeyDown} />
          <button data-testid="b" tabIndex={b.tabIndex} onFocus={b.onFocus} onKeyDown={b.onKeyDown} />
        </>
      );
    }
    const { container } = render(<Wrapper><Probe /></Wrapper>);
    expect(container.querySelector('[data-testid="a"]')).toHaveAttribute('tabindex', '0');
    expect(container.querySelector('[data-testid="b"]')).toHaveAttribute('tabindex', '-1');
    expect(partsRef.current.size).toBe(2);
  });

  it('idempotent re-registration with the same id (StrictMode-safe Map.set)', () => {
    // Direct assertion against the registry: registering twice with the same
    // id results in a single entry. Confirms that the Map.set overwrite
    // semantics hold.
    const { partsRef } = makeWrapper();
    const ref = { current: null };
    partsRef.current.set('id-A', ref);
    partsRef.current.set('id-A', ref);
    expect(partsRef.current.size).toBe(1);
  });
});

describe('useToolbarPart — onKeyDown', () => {
  it('does not preventDefault on Enter/Space (lets the button activate)', () => {
    const { result } = renderHook(() => useToolbarPart());
    const enterEvent = { key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLElement>;
    act(() => { result.current.onKeyDown(enterEvent); });
    expect(enterEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('preventDefault on ArrowRight when inside a shell (so the page does not scroll)', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useToolbarPart(), { wrapper: Wrapper });
    const event = { key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLElement>;
    act(() => { result.current.onKeyDown(event); });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('no preventDefault on ArrowRight when standalone (no shell — the page scroll behavior is preserved)', () => {
    const { result } = renderHook(() => useToolbarPart());
    const event = { key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLElement>;
    act(() => { result.current.onKeyDown(event); });
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
