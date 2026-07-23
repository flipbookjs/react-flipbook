import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Live `prefers-reduced-motion: reduce` state.
 *
 * Returns `false` during SSR and before mount (curl is a browser-only, post-mount
 * concern, so the pre-hydration default is "motion allowed"). Re-renders when the
 * OS setting toggles, so the curl-engine gate in FlipbookProvider re-evaluates
 * without needing a remount.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
