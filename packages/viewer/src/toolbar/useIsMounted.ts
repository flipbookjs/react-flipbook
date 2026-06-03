import { useEffect, useState } from 'react';

/**
 * Returns `false` on first render (mount-equivalent during SSR) and `true`
 * on every subsequent render after the post-mount effect commits. Used by
 * components that must render `null` during SSR + first client render,
 * then swap to their real output after hydration.
 *
 * The standard `typeof window !== 'undefined'` check at render time is NOT
 * sufficient for hydration: it returns true on the client's first render,
 * causing a hydration mismatch with the server's null output. The
 * useEffect-triggered re-render pattern below produces null on BOTH the
 * SSR pass AND the first client render, then the real output after.
 *
 * `<Toolbar>` uses this gate to avoid SSR/hydration mismatch on parts that
 * read the browser-only `helpers.canFullScreen` capability (which is
 * always false during SSR but typically true client-side, causing a flash
 * if not gated).
 */
export function useIsMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}
