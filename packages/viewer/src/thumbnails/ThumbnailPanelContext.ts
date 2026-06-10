import { createContext, useContext } from 'react';

/**
 * External store for the roving-tabindex active page index. Created
 * once per `<ThumbnailPanel>` mount; identity stable across the panel's
 * lifetime. Per-button selectors (`() => store.get() === pageIndex`)
 * subscribe via `useSyncExternalStore`, so only buttons whose selection
 * result CHANGES re-render — typically exactly 2 buttons per arrow-key
 * press, regardless of pageCount.
 *
 * Why a store (not `useState` + context): React's `useContext` re-renders
 * ALL consumers when the context value identity changes, bypassing
 * React.memo. For a 100-page panel that's 100 button re-renders per
 * arrow press; for 500+ pages it's perceptible jank. The store pattern
 * keeps re-renders proportional to actual state changes, not to consumer
 * count.
 */
export interface ActiveIndexStore {
  get: () => number;
  set: (value: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createActiveIndexStore(initial: number): ActiveIndexStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v) => {
      if (value === v) return;     // identity-stable: no notify on same-value set
      value = v;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
  };
}

export interface ThumbnailPanelContextValue {
  /** Active-tabstop store. Buttons subscribe via `useSyncExternalStore`. */
  store: ActiveIndexStore;
  /** Buttons register their DOM nodes here on mount so the panel can move
   *  focus via `focusIndex(...)` after arrow-key navigation. Cleanup-on-unmount
   *  via passing `null`. Stable identity. */
  registerButton: (pageIndex: number, element: HTMLButtonElement | null) => void;
  /** Imperatively focus the button for `pageIndex`. No-op if the button isn't
   *  currently mounted (e.g., index is out-of-DOM when DOM-level virtualization
   *  is later introduced). Stable identity. */
  focusIndex: (index: number) => void;
}

export const ThumbnailPanelContext = createContext<ThumbnailPanelContextValue | null>(null);

export function useThumbnailPanelContext(): ThumbnailPanelContextValue {
  const ctx = useContext(ThumbnailPanelContext);
  if (ctx === null) {
    throw new Error('useThumbnailPanelContext must be used inside <ThumbnailPanel>');
  }
  return ctx;
}
