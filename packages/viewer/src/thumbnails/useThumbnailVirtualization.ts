import { useEffect, useState } from 'react';

interface UseThumbnailVirtualizationArgs {
  pageCount: number;
  /** The scroll-root DOM element, or `null` when not mounted (panel closed).
   *  Pass via a callback-ref-into-state pattern from the caller — NOT a
   *  RefObject, because ref `.current` changes are not reactive and the
   *  inner scroll root mounts/unmounts on panel open/close. See file header
   *  rationale. */
  scrollRoot: HTMLElement | null;
  itemSelector: string;
  overscan?: number;
}

interface VisibleRange {
  start: number;
  end: number;
}

/**
 * IntersectionObserver-based horizontal windowing for the thumbnail
 * panel. Returns the current visible range of `pageIndex` values
 * (inclusive on `start`, EXCLUSIVE on `end`), expanded by `overscan`
 * on each side.
 *
 * Observer is created once per `(scrollRoot, pageCount)` pair. A
 * MutationObserver watches the scroll root's children so that
 * thumbnail buttons added/removed across re-renders are correctly
 * (un)observed. Both observers are torn down on unmount, dependency
 * change, OR when `scrollRoot` transitions to `null` (panel closes →
 * inner content unmounts → caller updates state → effect re-runs and
 * cleans up).
 *
 * Returns `{ start: 0, end: 0 }` when the panel is closed (scrollRoot
 * null) AND until the first IntersectionObserver callback fires after
 * an open. Callers should render placeholders for out-of-range pages.
 */
export function useThumbnailVirtualization({
  pageCount,
  scrollRoot,
  itemSelector,
  overscan = 5,
}: UseThumbnailVirtualizationArgs): { visibleRange: VisibleRange } {
  const [visibleRange, setVisibleRange] = useState<VisibleRange>({ start: 0, end: 0 });

  useEffect(() => {
    if (scrollRoot === null) {
      // Panel closed (or not yet mounted) — no observer; reset to empty
      // window so a stale prior range doesn't leak across open cycles.
      setVisibleRange((prev) => prev.start === 0 && prev.end === 0 ? prev : { start: 0, end: 0 });
      return;
    }
    if (pageCount === 0) {
      setVisibleRange({ start: 0, end: 0 });
      return;
    }
    const root = scrollRoot;

    const visibleIndices = new Set<number>();

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idxAttr = (entry.target as HTMLElement).dataset.pageIndex;
          if (idxAttr === undefined) continue;
          const idx = Number.parseInt(idxAttr, 10);
          if (Number.isNaN(idx)) continue;
          if (entry.isIntersecting) {
            visibleIndices.add(idx);
          } else {
            visibleIndices.delete(idx);
          }
        }
        if (visibleIndices.size === 0) {
          setVisibleRange((prev) => prev);   // no change; preserves prior range
          return;
        }
        // forEach loop instead of Math.min(...visibleIndices) — function-
        // argument spread has an engine-imposed upper bound (~10k in V8)
        // that could blow the stack on extreme viewport widths showing
        // thousands of thumbs simultaneously. Realistically not possible
        // with v0.1's viewport-bounded virtualization, but defensive.
        let minIdx = Infinity;
        let maxIdx = -Infinity;
        visibleIndices.forEach((i) => {
          if (i < minIdx) minIdx = i;
          if (i > maxIdx) maxIdx = i;
        });
        const start = Math.max(0, minIdx - overscan);
        const end = Math.min(pageCount, maxIdx + overscan + 1);
        setVisibleRange((prev) =>
          prev.start === start && prev.end === end ? prev : { start, end },
        );
      },
      { root, rootMargin: '0px', threshold: 0 },
    );

    const observeAll = () => {
      const items = root.querySelectorAll(itemSelector);
      items.forEach((item) => intersectionObserver.observe(item));
    };

    observeAll();

    const mutationObserver = new MutationObserver(() => {
      // A button was added or removed. Re-observe the current set.
      // IntersectionObserver dedupes; .observe on an already-observed
      // element is a no-op.
      observeAll();
    });
    mutationObserver.observe(root, { childList: true, subtree: false });

    return () => {
      intersectionObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [scrollRoot, pageCount, overscan, itemSelector]);

  return { visibleRange };
}
