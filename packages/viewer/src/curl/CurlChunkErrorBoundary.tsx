import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  hasError: boolean;
}

/**
 * Error boundary scoped to the lazy-loaded curl chunk.
 *
 * Catches:
 * - Promise rejection from `React.lazy(() => import('./curl/CurlOverlay'))` when the
 *   chunk fails to download (network error, content-blocker, CDN outage). React's
 *   Suspense+lazy machinery converts the rejection into a render-time throw that
 *   reaches the nearest error boundary.
 * - Render-time errors thrown inside CurlOverlay's subtree.
 *
 * Renders `null` on error — curl silently disables, base viewer (spreads, keyboard
 * nav, ARIA) remains functional. Curl is an enhancement per Decision 1 + Decision 14;
 * its failure must NOT propagate to the viewer's outer ErrorBoundary, which would
 * render the consumer's `renderError` fallback for the WHOLE viewer.
 *
 * Does NOT auto-reset on prop change — once curl fails for a session, it stays
 * disabled until the consumer remounts the viewer. This matches React error-boundary
 * default semantics and avoids retry loops on persistent failures.
 */
export class CurlChunkErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[flipbook] curl chunk failed to load or rendered an error; curl disabled for this session',
        error,
        info,
      );
    }
  }

  render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
