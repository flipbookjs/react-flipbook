import { useEffect, useLayoutEffect } from 'react';

/**
 * `useLayoutEffect` on the client, `useEffect` on the server. Suppresses the
 * "useLayoutEffect does nothing on the server" warning that React emits in
 * certain configurations, and avoids the conceptual mismatch (layout effects
 * are meaningless without a layout phase).
 *
 * Used by `FlipbookProvider`'s snapshot-store update effect (Phase 5.3) — on
 * the server, the snapshot ref is never read by subscribers (SSR uses
 * `getServerSnapshot` directly), so the effect not firing is the correct
 * behavior.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
