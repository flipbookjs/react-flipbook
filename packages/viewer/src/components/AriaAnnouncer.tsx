import { useFlipbookContext } from '../core/FlipbookContext';

export function AriaAnnouncer() {
  const { state, spreads } = useFlipbookContext();
  const spread = spreads[state.currentSpreadIndex];

  let announcement: string;
  if (!spread) {
    announcement = '';
  } else if (state.resolvedViewMode === 'single') {
    // Single mode. Invariant from computeSpreads: every single-mode
    // spread is { left: null, right: pageIndex } with right non-null.
    if (spread.right === null) {
      throw new Error('AriaAnnouncer: single-mode spread has null right page');
    }
    announcement = `Page ${spread.right + 1} of ${state.pageCount}`;
  } else {
    // Dual mode. Invariant from computeSpreads: when `spread` is defined
    // (pageCount > 0), at least one of left/right is non-null.
    const left = spread.left;
    const right = spread.right;
    if (left !== null && right !== null) {
      announcement = `Pages ${left + 1} and ${right + 1} of ${state.pageCount}`;
    } else if (left !== null) {
      announcement = `Page ${left + 1} of ${state.pageCount}`;
    } else if (right !== null) {
      announcement = `Page ${right + 1} of ${state.pageCount}`;
    } else {
      // Unreachable per computeSpreads invariant. Fail loud (Rule 1) if it ever fires.
      throw new Error('AriaAnnouncer: spread has neither left nor right page');
    }
  }

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fbjs-sr-only"
    >
      {announcement}
    </div>
  );
}
