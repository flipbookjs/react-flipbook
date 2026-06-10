import { createContext, useContext, type MutableRefObject } from 'react';

/**
 * Carries stable refs (identity never rotates) that internal toolbar parts
 * need to mutate or read, but that don't belong in `FlipbookContextValue`
 * (which rotates on every reducer dispatch via the `state` field).
 *
 * Subscribers to this context never re-render from reducer dispatches —
 * the provider's value useMemo has `[]` deps. Consumers read refs and
 * mutate `.current` imperatively in event handlers.
 *
 * Currently carries `lastFocusedFullScreenButtonRef` (Step 6E). Future
 * stable refs can be added here without breaking existing consumers.
 */
export interface FlipbookRefsContextValue {
  /** Written by `<FullScreenButton>` on click; read by `useFullScreen` on
   *  exit to restore focus. `document.contains()` check downstream triggers
   *  the `.fbjs-container` fallback when the originating button has
   *  unmounted. */
  lastFocusedFullScreenButtonRef: MutableRefObject<HTMLButtonElement | null>;
}

export const FlipbookRefsContext = createContext<FlipbookRefsContextValue | null>(null);

export function useFlipbookRefs(): FlipbookRefsContextValue {
  const ctx = useContext(FlipbookRefsContext);
  if (ctx === null) throw new Error('useFlipbookRefs must be used within FlipbookProvider');
  return ctx;
}
