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
import { resolveItemDimensions, trueMedian, type Density } from './resolveItemDimensions';
import type { PageSource } from '../types/PageSource';
import { devWarn } from '../core/devWarn';

// Module-level dedup for the both-supplied warn. Lives at module scope (NOT
// inside the panel component body) so the once-per-process contract holds —
// declared inside the function it would reset every render. Same pattern as
// `warnedDeprecations` in Flipbook.tsx:21. Production stays cost-free: the
// entire guard body is gated on `process.env.NODE_ENV !== 'production'` via
// the early-return, so bundlers DCE the assignment and the devWarn call.
const warnedPanelBothSupplied = { triggered: false };
function warnOncePanelBothSupplied(): void {
  if (process.env.NODE_ENV === 'production') return;
  if (warnedPanelBothSupplied.triggered) return;
  warnedPanelBothSupplied.triggered = true;
  devWarn(
    `ThumbnailPanel: both density and width are supplied; width wins. Drop one to silence this warning.`,
  );
}

/** Public props for `<ThumbnailPanel>`. The 2.0 discriminated union prevents
 *  supplying BOTH `density` AND `width` at the type level (callers using
 *  the public types get a TS error). A JS-side bypass (untyped caller,
 *  `as any` cast) is caught at runtime by the `warnedPanelBothSupplied`
 *  guard above.
 *
 *  - `density?: 'compact' | 'comfortable' | 'spacious'` — relative density.
 *    Default `'comfortable'` (5 median-width thumbnails fit across the
 *    panel's content width, plus their inter-thumb gaps). Pixel widths
 *    adapt to the panel's container — embed in a 400 px sidebar and the
 *    thumbnails shrink accordingly.
 *  - `width?: number` — absolute pixel width per thumbnail. Clamped to
 *    [80, 2048]; values outside the range clamp at the prop boundary with
 *    a dev-warn for values above the ceiling.
 *
 *  Note: the `<Flipbook>` parent surface uses the namespaced names
 *  `thumbnailDensity` / `thumbnailWidth`. The panel's direct-composable
 *  surface uses the shorter unprefixed names since the component name
 *  already provides the context. See `MIGRATION-v2.md`. */
export type ThumbnailPanelProps =
  | { density?: Density; width?: never }
  | { density?: never; width: number };

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
 *     value live across `density` / `width` / source rotations.
 *
 * When open: renders one `<ThumbnailButton>` per page; virtualizes
 * canvas-rendering via `useThumbnailVirtualization` so only the
 * visible window has live canvases. Active canvas count is bounded
 * by `visible-window + 2 × overscan` — viewport-relative, not
 * document-length-dependent (typically 10-40 active for normal
 * displays).
 *
 * Per-page sizing computed from `PageSource.getPageSize(idx)` (sync
 * post-init) routed through `resolveItemDimensions` (extracted to its
 * own file for unit testing). Per-page heights derive from each page's
 * actual aspect ratio. In density mode, per-page WIDTHS scale relative
 * to the document's TRUE-MEDIAN page width — so mixed-orientation PDFs
 * preserve their visual variety while still hitting the "N median-width
 * thumbnails fit" target on average. In explicit-width mode every page
 * gets the same width.
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
export const ThumbnailPanel = memo(function ThumbnailPanel(props: ThumbnailPanelProps = {}) {
  // Destructure both possible shapes of the discriminated union via index
  // access — TS can't narrow `density`/`width` through a destructure on the
  // raw union, but reading them as optional indices yields the right runtime
  // values either way.
  const density = (props as { density?: Density }).density;
  const width = (props as { width?: number }).width;

  // Both-supplied dev-warn (panel surface). TypeScript prevents this for
  // typed callers; JS-side bypass triggers the once-per-process warn.
  // Precedence: width wins (matches the resolver's resolution order — step 2
  // explicit-width takes priority over step 3 density).
  if (density !== undefined && width !== undefined) {
    warnOncePanelBothSupplied();
  }

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
  // Measured container metrics: contentWidth (scroll container's clientWidth
  // minus horizontal padding) AND the inter-thumb gap (CSS column-gap).
  // Combined into one state object so a single ResizeObserver callback
  // commits both atomically — avoids interleaved renders where width has the
  // new value but gap has the old. State persists across close/open cycles;
  // subsequent opens skip the two-pass first-paint flicker. Trade-off:
  // resize-while-closed produces a one-frame "snap" on the next open as the
  // layout effect re-measures and corrects the stale cache; accepted because
  // the common case (open without intervening resize) gets the fast path.
  const [containerMetrics, setContainerMetrics] = useState<{
    contentWidth: number;
    gapPx: number;
  } | null>(null);
  // Measured open-panel max-height. JS replaces a CSS open-state max-height
  // so the slide animation transitions between 0 and the actual content
  // height — letting the panel adapt to whatever the resolver produces
  // without the strip clipping the bottoms of the pages. `null` before
  // first measurement; the open-state inline style only applies once a
  // real value is present (no `0 → 0` no-op transition on first open).
  const [openMaxHeight, setOpenMaxHeight] = useState<number | null>(null);
  const buttonsRef = useRef<Map<number, HTMLButtonElement>>(new Map());
  // Ref-based gate for the ResizeObserver's height-measurement branch. Read
  // through a ref inside the observer callback so the observer doesn't get
  // rebuilt every time `dimensions` flips null → non-null. Effect-dep-based
  // gating would tear down and rebuild the observer on every flip — a
  // sub-microsecond gap during which a resize would be missed. The ref
  // pattern keeps one observer alive for the scrollRoot's lifetime.
  const dimensionsReadyRef = useRef(false);

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

  // Doc-level metrics: changes only when source rotates. Caches the
  // pageSizes vector + TRUE median pageWidth (the reference for per-page
  // density scaling). The sort runs once per source change, not once per
  // container-resize tick — critical for long PDFs.
  //
  // `slice.pageCount` is in the deps so a SOURCE_CHANGED dispatch that
  // updates the reducer (one tick after source rotation) still triggers a
  // memo re-run even though the body reads `source.getPageCount()` (the
  // live, source-truth value).
  const referenceMetrics = useMemo(() => {
    if (slice.status !== 'ready' || source === null) return null;
    const count = source.getPageCount();
    if (count === 0) return { pageSizes: [] as Array<{ width: number; height: number }>, referenceWidth: 1 };

    const pageSizes: Array<{ width: number; height: number }> = [];
    for (let i = 0; i < count; i++) pageSizes.push(source.getPageSize(i));
    const sortedWidths = pageSizes.map((s) => s.width).sort((a, b) => a - b);
    // `trueMedian` returns 1 for empty input (already guarded above) and
    // the textbook median otherwise. The `|| 1` guards the degenerate
    // case where every page width is 0 (would propagate as a NaN multiplier
    // downstream in the per-page width scaling).
    const referenceWidth = trueMedian(sortedWidths) || 1;
    return { pageSizes, referenceWidth };
  }, [source, slice.status, slice.pageCount]);

  // Per-resize / per-prop dimensions vector. O(N) only — no sort, no
  // getPageSize calls. Re-runs on container resize (containerMetrics
  // identity change) OR prop change (density / width).
  const dimensions = useMemo(() => {
    if (!referenceMetrics || containerMetrics === null) return null;
    const { pageSizes, referenceWidth } = referenceMetrics;
    return pageSizes.map((ps) =>
      resolveItemDimensions(
        density,
        width,
        ps,
        containerMetrics.contentWidth,
        referenceWidth,
        containerMetrics.gapPx,
      ),
    );
  }, [referenceMetrics, density, width, containerMetrics]);

  // Keep the gate-ref in sync with the dimensions state. Reading through
  // a ref inside the observer callback (rather than as an effect dep) is
  // what avoids tearing down and rebuilding the observer on every flip.
  useIsomorphicLayoutEffect(() => {
    dimensionsReadyRef.current = dimensions !== null;
  }, [dimensions]);

  // ResizeObserver lifecycle. ONE observer per scrollRoot mount. Cache
  // padX + gapPx once via getComputedStyle (forces style resolution — ~10x
  // clientWidth cost; not worth running on every resize). Both are static
  // per stylesheet — re-reading them on every fire would defend against a
  // scenario (live padding/gap change) that doesn't happen in practice.
  //
  // No rAF throttle. ResizeObserver already fires at most once per layout
  // pass (browser-coalesced). rAF would defer the setState into the next
  // frame's callback queue, lagging the visible resize response by one
  // frame for no benefit.
  useIsomorphicLayoutEffect(() => {
    if (!scrollRoot) return;

    const computed = getComputedStyle(scrollRoot);
    const parsePx = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const padX = parsePx(computed.paddingLeft) + parsePx(computed.paddingRight);
    // CSS `gap` shorthand resolves to `column-gap` for flex containers;
    // read `columnGap` directly — `gap` itself is not always exposed.
    const gapPx = parsePx(computed.columnGap || computed.gap || '0');

    const measure = () => {
      setContainerMetrics({
        contentWidth: Math.max(0, scrollRoot.clientWidth - padX),
        gapPx,
      });
      // Gated height measurement: only commit `openMaxHeight` once
      // dimensions have resolved AND the buttons have committed —
      // otherwise the empty scroll-shell's scrollHeight (just the
      // padding) would commit and produce a multi-step transition
      // visible as a stutter on first open.
      if (dimensionsReadyRef.current) {
        setOpenMaxHeight(scrollRoot.scrollHeight);
      }
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(scrollRoot);

    return () => ro.disconnect();
  }, [scrollRoot]);

  // Trigger one extra measure pass when dimensions flips null → non-null,
  // so openMaxHeight catches up with the now-mounted buttons. Does NOT
  // rebuild the observer; the next ResizeObserver fire would also catch
  // it, but doing it eagerly removes one frame of "open at maxHeight=null"
  // delay before the first slide-animation paint.
  useIsomorphicLayoutEffect(() => {
    if (!scrollRoot || dimensions === null) return;
    setOpenMaxHeight(scrollRoot.scrollHeight);
  }, [scrollRoot, dimensions]);

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
  //
  // Scroll container shell mounts unconditionally when open (NOT gated on
  // `dimensions !== null`). The shell is the ResizeObserver target — gating
  // it on `dimensions` would create a chicken-and-egg: dimensions depends
  // on containerMetrics, containerMetrics needs the shell to exist, but the
  // shell wouldn't render until dimensions resolved. Splitting shell from
  // button-list breaks the cycle: the shell mounts → ResizeObserver attaches
  // → containerMetrics resolves → dimensions resolves → button list mounts.
  const inner = slice.isOpen && slice.status === 'ready' && source !== null ? (
    <div ref={setScrollRoot} className="fbjs-thumbnail-panel__scroll">
      {dimensions !== null
        ? Array.from({ length: realPageCount }, (_, i) => {
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
          })
        : null}
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
