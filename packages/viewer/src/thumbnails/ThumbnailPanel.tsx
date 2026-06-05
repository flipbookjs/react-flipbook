import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import { useFlipbookSelector, shallowEqual } from '../hooks/useFlipbook';
import { useIsomorphicLayoutEffect } from '../hooks/useIsomorphicLayoutEffect';
import { useIsMounted } from '../toolbar/useIsMounted';
import { LABELS } from '../toolbar/labels';
import { ThumbnailButton } from './ThumbnailButton';
import {
  ThumbnailPanelContext,
  createActiveIndexStore,
  type ActiveIndexStore,
} from './ThumbnailPanelContext';
import { useThumbnailVirtualization } from './useThumbnailVirtualization';
import type { PageSource } from '../types/PageSource';

const THUMB_SCALE = 0.2;

interface ThumbnailPanelSlice {
  isOpen: boolean;
  pageNumber: number;
  pageCount: number;
  status: 'loading' | 'ready' | 'error';
}

/**
 * Built-in thumbnail panel — horizontal-scroll strip of page thumbnails
 * rendered above the bottom toolbar. Reads `state.thumbnailsOpen` and:
 *
 *   - Returns `null` ONLY before `useIsMounted` commits (SSR + first
 *     client render). After mount, returns a JSX tree whose outer shell
 *     always stays in the DOM (required for the CSS slide animation).
 *   - When closed (`state.thumbnailsOpen === false`): outer shell
 *     remains mounted with `data-open="false"` + `aria-hidden="true"`;
 *     CSS shrinks it to `max-height: 0` so it takes no visible space;
 *     inner content (scroll container + buttons + canvases) is absent
 *     so canvas memory + observers release.
 *   - When open: outer + inner both render; CSS animates `max-height`
 *     to 14rem.
 *
 * When open: renders one `<ThumbnailButton>` per page; virtualizes
 * canvas-rendering via `useThumbnailVirtualization` so only the
 * visible window has live canvases. Active canvas count is bounded
 * by `visible-window + 2 × overscan` — viewport-relative, not
 * document-length-dependent (typically 10-40 active for normal
 * displays).
 *
 * Per-page sizing computed from `PageSource.getPageSize(idx)` (sync
 * post-init) scaled by `THUMB_SCALE = 0.2`. Per-page sizing supports
 * mixed-orientation PDFs.
 *
 * The panel container has `role="region"` + `aria-label` for AT users.
 * The toggle button (`<ThumbnailsToggleButton>`) reflects `aria-pressed`
 * + `aria-expanded` but does NOT set `aria-controls`.
 *
 * Source is read via a narrow `useFlipbookSelector` selection (NOT
 * `useFlipbookContext`) so unrelated state changes (zoom, theme,
 * page navigation) do not cascade re-renders through the panel —
 * only source rotation triggers a panel-level re-render. The
 * 4-field `slice` separately tracks pageNumber / pageCount / status
 * for content rendering.
 *
 * Roving-tabindex state lives in an external store (`ActiveIndexStore`)
 * created once via `useRef` lazy init. Buttons subscribe via
 * `useSyncExternalStore` with per-button boolean selectors. The
 * context value (containing the store + two stable callbacks) NEVER
 * changes identity after first render — so React.memo on the
 * panel-context layer never triggers consumer re-renders. Per-button
 * re-renders are gated by the `useSyncExternalStore` selector flips.
 */
export const ThumbnailPanel = memo(function ThumbnailPanel() {
  const isMounted = useIsMounted();
  // Source via narrow selector — only re-renders on source rotation
  // (status === 'ready' transition or source object identity change).
  // Reading via useFlipbookContext would subscribe to the full context
  // and cascade re-renders on every state mutation.
  const source = useFlipbookSelector(
    (s) => s.status === 'ready' ? s.source : null,
    Object.is,
  );
  const slice = useFlipbookSelector<ThumbnailPanelSlice>(
    (s) => ({
      isOpen: s.state.thumbnailsOpen,
      pageNumber: s.state.pageNumber,
      // The 6A public hook surface (`FlipbookHookState`) names the document
      // page count `totalPages`. The reducer field is `pageCount`, but
      // FlipbookProvider's snapshot builder maps it: `totalPages: state.pageCount`.
      // Read `s.state.totalPages` here; we keep the slice's internal name
      // `pageCount` because that's the local-variable convention.
      pageCount: s.state.totalPages,
      status: s.status,
    }),
    shallowEqual,
  );
  const panelId = useId();
  // Scroll root tracked via STATE (callback-ref), not useRef. The inner
  // scroll-container div only mounts when the panel is open, so a
  // `useRef`-based design would see `null` on the virtualization hook's
  // first effect run AND would not re-run when the div later mounts
  // (refs are not reactive). Callback ref into state means: mount →
  // setScrollRoot(div) → state change → hook effect re-runs with the
  // live element. Unmount on close → setScrollRoot(null) → hook tears
  // down observers. Both transitions observed.
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const buttonsRef = useRef<Map<number, HTMLButtonElement>>(new Map());

  // ActiveIndexStore — created ONCE per panel mount via useRef lazy
  // init. Stable identity for the panel's lifetime; context value
  // memoization never invalidates. Buttons subscribe via
  // useSyncExternalStore.
  const storeRef = useRef<ActiveIndexStore | null>(null);
  if (storeRef.current === null) {
    // pageNumber is guaranteed >= 1 by 6A's snapshot construction
    // (FlipbookProvider.tsx:600 — `state.pageCount > 0 ? anchorPage0 + 1 : 1`),
    // so `pageNumber - 1` is always >= 0. No defensive clamp needed.
    storeRef.current = createActiveIndexStore(slice.pageNumber - 1);
  }
  const store = storeRef.current;

  // Sync the store from `slice.pageNumber` when EXTERNAL navigation
  // moves the current page (prev/next toolbar buttons, keyboard
  // shortcuts, click-on-page-in-document). useIsomorphicLayoutEffect
  // (not useEffect) runs after commit but BEFORE the browser paints,
  // so the sync is visible in the same frame as the panel re-render.
  // Why not derive isActive from pageNumber directly? Because user-
  // initiated arrow-key navigation inside the panel sets the store
  // FIRST (for instant focus migration), then dispatches goToPage; if
  // tabIndex were derived from pageNumber, the user would see a one-
  // frame focus mismatch between arrow press and React commit.
  useIsomorphicLayoutEffect(() => {
    store.set(slice.pageNumber - 1);
  }, [slice.pageNumber, store]);

  const registerButton = useCallback((pageIndex: number, element: HTMLButtonElement | null) => {
    if (element === null) {
      buttonsRef.current.delete(pageIndex);
    } else {
      buttonsRef.current.set(pageIndex, element);
    }
  }, []);

  const focusIndex = useCallback((index: number) => {
    const button = buttonsRef.current.get(index);
    if (button) button.focus();
  }, []);

  // All three deps are stable for the panel's lifetime — `store` is the
  // lazy-init ref, `registerButton`/`focusIndex` are useCallback([]).
  // This memo never invalidates after first render. Context consumers
  // (the ThumbnailButtons) never re-render because of context-identity
  // changes; their re-renders are driven entirely by per-button
  // useSyncExternalStore selectors flipping.
  const panelCtxValue = useMemo(
    () => ({ store, registerButton, focusIndex }),
    [store, registerButton, focusIndex],
  );

  const { visibleRange } = useThumbnailVirtualization({
    pageCount: slice.pageCount,
    scrollRoot,
    itemSelector: '[data-page-index]',
  });

  // Compute per-page dimensions (synchronous, getPageSize is post-init).
  // Memoized on (source, pageCount) — re-renders when source rotates.
  const dimensions = useMemo(() => {
    if (slice.status !== 'ready' || source === null) return null;
    const result: Array<{ width: number; height: number }> = [];
    for (let i = 0; i < slice.pageCount; i++) {
      const size = source.getPageSize(i);
      result.push({
        width: Math.round(size.width * THUMB_SCALE),
        height: Math.round(size.height * THUMB_SCALE),
      });
    }
    return result;
  }, [source, slice.status, slice.pageCount]);

  if (!isMounted) return null;

  // Slide-animation contract: the outer shell ALWAYS renders when
  // isMounted, regardless of `slice.isOpen`. Returning null when closed
  // would yank the element from DOM and skip the CSS `max-height` transition
  // entirely (transitions require an in-DOM element whose property changes).
  // Inner content (scroll container + buttons + canvases + IntersectionObserver
  // root) mounts only when actually open. Close still releases canvas memory
  // and disconnects observers — only the lightweight outer div persists.
  //
  // ARIA: `aria-hidden="true"` when closed removes the empty region from the
  // accessibility tree so AT users don't get announced "Page thumbnails" on
  // initial mount before interaction.
  const inner =
    slice.isOpen && slice.status === 'ready' && source !== null && dimensions !== null ? (
      <div ref={setScrollRoot} className="fbjs-thumbnail-panel__scroll">
        {Array.from({ length: slice.pageCount }, (_, i) => {
          const dim = dimensions[i];
          const inWindow = i >= visibleRange.start && i < visibleRange.end;
          return (
            <ThumbnailButton
              key={i}
              source={source as PageSource}
              pageIndex={i}
              pageCount={slice.pageCount}
              width={dim.width}
              height={dim.height}
              inWindow={inWindow}
            />
          );
        })}
      </div>
    ) : null;

  return (
    <ThumbnailPanelContext.Provider value={panelCtxValue}>
      <div
        id={panelId}
        className="fbjs-thumbnail-panel"
        data-open={slice.isOpen ? 'true' : 'false'}
        role="region"
        aria-label={LABELS.thumbnailPanelLabel}
        aria-hidden={slice.isOpen ? undefined : 'true'}
      >
        {inner}
      </div>
    </ThumbnailPanelContext.Provider>
  );
});
