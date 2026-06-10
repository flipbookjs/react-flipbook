import { memo, useCallback, useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import { useFlipbookActions, useFlipbookSelector } from '../hooks/useFlipbook';
import { ThumbnailCanvas } from './ThumbnailCanvas';
import { useThumbnailPanelContext } from './ThumbnailPanelContext';
import { LABELS } from '../toolbar/labels';
import type { PageSource } from '../types/PageSource';

interface ThumbnailButtonProps {
  source: PageSource;
  pageIndex: number;       // 0-indexed
  pageCount: number;
  width: number;
  height: number;
  inWindow: boolean;       // from useThumbnailVirtualization
}

/**
 * One thumbnail button. Renders a real `<ThumbnailCanvas>` when
 * `inWindow === true`, an empty placeholder otherwise.
 *
 * Two ARIA states tracked SEPARATELY:
 *
 *   1. `aria-current="page"` — the current document page. Derived from
 *      `state.pageNumber` via a per-button `useFlipbookSelector`: matches
 *      when `pageIndex + 1 === pageNumber`. In dual-cover mode this marks
 *      only the LEADING page of the current spread (spread-aware
 *      highlighting deferred to a later release).
 *
 *   2. `tabIndex` — the roving tabstop. Derived from the panel's external
 *      `ActiveIndexStore` via `useSyncExternalStore` with a per-button
 *      boolean selector (`() => store.get() === pageIndex`). React's
 *      `useSyncExternalStore` only re-renders when the boolean flips —
 *      so an arrow-key press that moves the active index from N to N+1
 *      re-renders exactly TWO buttons (N and N+1), regardless of pageCount.
 *      Avoids the O(pageCount) re-render cascade that a useState+context
 *      design would cause.
 *
 * Arrow Left/Right/Home/End + Enter/Space:
 *   - Arrow keys: compute next index, push to store via `store.set(...)`,
 *     focus the target button via `focusIndex(...)`, AND dispatch `goToPage`
 *     (1-INDEXED — `nextIndex + 1`). All three happen so tabstop,
 *     focus, and current-page stay coherent.
 *   - Enter/Space: native button activation triggers `onClick`, which
 *     calls `store.set(pageIndex) + goToPage(pageIndex + 1)`.
 *   - Focus event: `store.set(pageIndex)` so click-to-focus also moves
 *     the tabstop. The store's set is a no-op when value is unchanged
 *     (identity check inside `set`).
 */
export const ThumbnailButton = memo(function ThumbnailButton({
  source,
  pageIndex,
  pageCount,
  width,
  height,
  inWindow,
}: ThumbnailButtonProps) {
  const { goToPage } = useFlipbookActions();
  const { store, registerButton, focusIndex } = useThumbnailPanelContext();
  const isCurrent = useFlipbookSelector(
    (s) => s.state.pageNumber - 1 === pageIndex,
    Object.is,
  );
  // Selector returns boolean; only re-renders this button when its
  // active state actually flips. Two re-renders per arrow press
  // (was-active button + now-active button), not pageCount.
  const isActive = useSyncExternalStore(
    store.subscribe,
    () => store.get() === pageIndex,
  );
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Register/deregister with the panel context so focusIndex(...) can
  // find this button by pageIndex. Cleanup-on-unmount via the effect
  // teardown — handles the case where the button is unmounted as the
  // window scrolls past it (not currently the v0.1 behavior since DOM-
  // level virtualization is deferred — but the contract is correct for
  // when DOM-level virtualization is later introduced).
  useEffect(() => {
    registerButton(pageIndex, buttonRef.current);
    return () => registerButton(pageIndex, null);
  }, [pageIndex, registerButton]);

  const handleClick = useCallback(() => {
    store.set(pageIndex);
    goToPage(pageIndex + 1);   // goToPage is 1-indexed (per the 6A actions contract)
  }, [goToPage, pageIndex, store]);

  const handleFocus = useCallback(() => {
    store.set(pageIndex);
  }, [pageIndex, store]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      let nextIndex: number | null = null;
      if (e.key === 'ArrowRight' && pageIndex + 1 < pageCount) {
        nextIndex = pageIndex + 1;
      } else if (e.key === 'ArrowLeft' && pageIndex > 0) {
        nextIndex = pageIndex - 1;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = pageCount - 1;
      }
      // Arrow Up / Down deliberately unhandled — v0.1 ships horizontal-only
      // navigation. Vertical direction support is v0.2.
      if (nextIndex !== null) {
        e.preventDefault();
        store.set(nextIndex);
        focusIndex(nextIndex);
        goToPage(nextIndex + 1);
      }
      // Enter/Space → native button activation → onClick fires.
    },
    [goToPage, pageIndex, pageCount, store, focusIndex],
  );

  return (
    <button
      ref={buttonRef}
      type="button"
      className="fbjs-thumbnail-button"
      style={{ width: `${width}px` }}
      aria-label={LABELS.thumbnailButton(pageIndex + 1, pageCount)}
      aria-current={isCurrent ? 'page' : undefined}
      tabIndex={isActive ? 0 : -1}
      data-page-index={pageIndex}
      data-testid={`fbjs-thumbnail-${pageIndex}`}
      onClick={handleClick}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      {inWindow ? (
        <ThumbnailCanvas
          source={source}
          pageIndex={pageIndex}
          width={width}
          height={height}
        />
      ) : (
        // Placeholder — sized but empty. Keeps scroll-position stable.
        <div
          className="fbjs-thumbnail-button__canvas-host"
          style={{ width: `${width}px`, height: `${height}px` }}
          aria-hidden="true"
        />
      )}
      <span className="fbjs-thumbnail-button__page-number">{pageIndex + 1}</span>
    </button>
  );
});
