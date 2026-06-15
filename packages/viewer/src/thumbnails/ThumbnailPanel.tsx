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
import { devWarn } from '../core/devWarn';

const THUMB_SCALE = 0.2;
const SIZE_PX = { small: 360, default: 480, large: 720 } as const;
const MAX_THUMB_WIDTH = 2048;

// Module-level once-per-bad-value guard for sanitization warnings. Lives in
// module scope (not React state) so re-renders with the same bad value don't
// re-warn. Cleared only on full module reload (page reload in dev / HMR).
//
// The entire dedup body is gated on `process.env.NODE_ENV !== 'production'`
// via the early-return in `warnOnceForSize`. `devWarn` alone is DCE-stripped
// in production, but the surrounding `Set.has` / `Set.add` calls would still
// execute (and the Set would still grow) without the explicit guard.
// Wrapping the function body means bundlers eliminate the entire dedup logic
// in production: no Set growth, no method calls, no runtime cost.
const warnedSizes = new Set<unknown>();
function warnOnceForSize(badValue: unknown, message: string): void {
  if (process.env.NODE_ENV === 'production') return;
  if (warnedSizes.has(badValue)) return;
  warnedSizes.add(badValue);
  devWarn(message);
}

/**
 * Resolve per-page render dimensions from the `size` prop + the source page
 * dimensions. Returns CSS layout `{ width, height }` AND the per-page render
 * `scale` (page-relative, DPR not included). The scale is consumed by
 * `<ThumbnailCanvas>` for its backing-store render — keeping CSS layout and
 * canvas rasterization in lockstep across `thumbnailSize` values.
 *
 *   - `size === undefined` (omitted) → preserves 0.1.0-alpha.1 behavior: per-page
 *     `pageWidth × 0.2`, `pageHeight × 0.2`, scale `0.2`.
 *   - Token (`'small' | 'default' | 'large'`) → maps to fixed itemWidth
 *     (360 / 480 / 720 px); scale = `itemWidth / pageWidth`.
 *   - Numeric → literal pixel itemWidth, with sanitization:
 *       - NaN / Infinity / ≤0 → falls back to `'default'` (480 px) with a
 *         once-per-bad-value dev-warn.
 *       - >MAX_THUMB_WIDTH (2048) → clamps to the cap with a dev-warn.
 *
 * Helper choice — `devWarn` (not raw `console.warn`). The codebase precedent
 * is split: defaultScale-after-mount uses `console.warn` (FlipbookProvider:294);
 * printScale / printMaxPages uses `devWarn`. We follow the printScale
 * precedent here — invalid `thumbnailSize` is consumer-visible feedback
 * during dev, silent in production (DCE-stripped). If a future commit unifies
 * the codebase on raw `console.warn`, this resolver moves with it.
 */
function resolveItemDimensions(
  size: 'small' | 'default' | 'large' | number | undefined,
  pageSize: { width: number; height: number },
): { width: number; height: number; scale: number } {
  // Omitted → 0.1.0-alpha.1 per-page behavior.
  if (size === undefined) {
    return {
      width: Math.round(pageSize.width * THUMB_SCALE),
      height: Math.round(pageSize.height * THUMB_SCALE),
      scale: THUMB_SCALE,
    };
  }
  let itemWidth: number;
  if (typeof size === 'number') {
    if (!Number.isFinite(size) || size <= 0) {
      warnOnceForSize(
        size,
        `ThumbnailPanel: thumbnailSize={${size}} is not a valid positive width; falling back to 'default' (${SIZE_PX.default}px).`,
      );
      itemWidth = SIZE_PX.default;
    } else if (size > MAX_THUMB_WIDTH) {
      warnOnceForSize(
        size,
        `ThumbnailPanel: thumbnailSize={${size}} exceeds MAX_THUMB_WIDTH (${MAX_THUMB_WIDTH}); clamping.`,
      );
      itemWidth = MAX_THUMB_WIDTH;
    } else {
      itemWidth = size;
    }
  } else {
    itemWidth = SIZE_PX[size];
  }
  const scale = itemWidth / pageSize.width;
  return {
    width: Math.round(itemWidth),
    height: Math.round(pageSize.height * scale),
    scale,
  };
}

/** Public props for `<ThumbnailPanel>`. Added in 1.0.0 to support
 *  the `<Flipbook thumbnailSize>` prop. Existing zero-arg `<ThumbnailPanel/>`
 *  call sites keep compiling — `size` is optional and its `undefined` branch
 *  preserves 0.1.0-alpha.1 sizing. */
export interface ThumbnailPanelProps {
  /** Bounding-box width of each thumbnail item. Omitted → preserves 0.1.0-alpha.1
   *  behavior (per-page `pageWidth × 0.2`). Tokens map to 360 / 480 / 720 px;
   *  number is the literal pixel width. Invalid numeric input (NaN / Infinity
   *  / ≤0) falls back to `'default'` (480 px) with a once-per-bad-value
   *  dev-warn; values above 2048 px clamp with a dev-warn. */
  size?: 'small' | 'default' | 'large' | number;
}

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
 *   - When open: outer + inner both render; a layout effect measures the
 *     scroll container's `scrollHeight` and applies it as an inline
 *     `max-height` on the outer shell, so the CSS transition animates
 *     from 0 to the measured content height. A `ResizeObserver` keeps the
 *     value live across thumbnailSize / source rotations.
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
export const ThumbnailPanel = memo(function ThumbnailPanel({ size }: ThumbnailPanelProps = {}) {
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
  // Measured open-panel max-height. JS replaces the CSS `max-height: 14rem`
  // open value so the slide animation transitions between 0 and the actual
  // content height — letting the panel adapt to whatever the `thumbnailSize`
  // prop resolves to without the strip clipping the bottoms of the pages.
  // `null` before first measurement; the open-state inline style only applies
  // once a real value is present (no `0 → 0` no-op transition on first open).
  const [openMaxHeight, setOpenMaxHeight] = useState<number | null>(null);
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

  // Measure the scroll container's content height and expose it as the
  // open-panel `max-height`. `scrollRoot` is the state-tracked __scroll
  // element (mounts only when the panel is open + source ready). When it
  // mounts, read `scrollHeight` — the intrinsic content height regardless
  // of any cap. A ResizeObserver catches subsequent changes (thumbnailSize
  // prop change at runtime, source rotation to a PDF with a different
  // aspect ratio, font scaling that shifts the page-number label height).
  //
  // On close: `scrollRoot` becomes `null`, the cleanup function runs
  // `ro.disconnect()`, the observer is gone. The React state
  // `openMaxHeight` persists across the close at the previous open's
  // measured value so the next open starts the slide animation at the
  // right target immediately (no flicker before re-measurement).
  //
  // Hook choice: `useIsomorphicLayoutEffect` (not raw `useLayoutEffect`)
  // matches the existing page-number sync effect above. ThumbnailPanel's
  // render body returns `null` during SSR via the `useIsMounted` gate, so
  // the layout-effect path never runs server-side regardless — but using
  // the isomorphic helper keeps the file consistent and avoids React's
  // "useLayoutEffect does nothing on the server" warning if the gate is
  // ever lifted.
  useIsomorphicLayoutEffect(() => {
    if (!scrollRoot) {
      return;
    }
    const measure = () => {
      setOpenMaxHeight(scrollRoot.scrollHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollRoot);
    return () => {
      ro.disconnect();
    };
  }, [scrollRoot]);

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

  // The page count used to size the panel's contents comes from the LIVE
  // source — NOT from `slice.pageCount` (which is `state.pageCount` from
  // the reducer). `state.pageCount` lags the source by one render after a
  // source rotation: the source-rotation effect that dispatches
  // SOURCE_CHANGED fires AFTER the render in which sourceState already
  // flipped to 'ready' with the new source. During that one-render window,
  // `slice.pageCount` still holds the OLD source's count while `source` is
  // already the NEW one — iterating `i < slice.pageCount` and calling
  // `source.getPageSize(i)` past the new source's actual pages returns
  // undefined and crashes downstream (`pageSize.width` of undefined).
  // Reading from `source.getPageCount()` removes the race: the source is
  // self-consistent. `slice.pageCount` remains in the selector + memo deps
  // below so the panel still re-renders when the reducer state catches up.
  const realPageCount = slice.status === 'ready' && source !== null
    ? source.getPageCount()
    : 0;

  const { visibleRange } = useThumbnailVirtualization({
    pageCount: realPageCount,
    scrollRoot,
    itemSelector: '[data-page-index]',
  });

  // Compute per-page dimensions (synchronous, getPageSize is post-init).
  // Memoized on (source, status, pageCount, size) — re-runs when source
  // rotates OR when the consumer changes the `thumbnailSize` prop. Without
  // `size` in the deps, a prop change would return stale cached dimensions
  // and the thumbnails would appear non-reactive to runtime size changes.
  // `slice.pageCount` is kept in the deps so a SOURCE_CHANGED dispatch that
  // updates the reducer (one tick after source rotation) still triggers a
  // memo re-run even though the body only reads `realPageCount`.
  const dimensions = useMemo(() => {
    if (slice.status !== 'ready' || source === null) return null;
    const count = source.getPageCount();
    const result: Array<{ width: number; height: number; scale: number }> = [];
    for (let i = 0; i < count; i++) {
      const pageSize = source.getPageSize(i);
      result.push(resolveItemDimensions(size, pageSize));
    }
    return result;
  }, [source, slice.status, slice.pageCount, size]);

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
        {Array.from({ length: realPageCount }, (_, i) => {
          const dim = dimensions[i];
          const inWindow = i >= visibleRange.start && i < visibleRange.end;
          return (
            <ThumbnailButton
              key={i}
              source={source as PageSource}
              pageIndex={i}
              pageCount={realPageCount}
              width={dim.width}
              height={dim.height}
              scale={dim.scale}
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
        style={
          slice.isOpen && openMaxHeight !== null
            ? { maxHeight: `${openMaxHeight}px` }
            : undefined
        }
      >
        {inner}
      </div>
    </ThumbnailPanelContext.Provider>
  );
});
