import type { CSSProperties, ReactNode } from 'react';
import { useFlipbookContext } from '../core/FlipbookContext';
import { PageRenderer } from './PageRenderer';

// Cover-open: how long the cover takes to slide from centre to its slot before the
// page turn fires. Kept in sync with FlipbookProvider's COVER_MOVE_MS.
const COVER_MOVE_MS = 450;
const COVER_MOVE_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

export function SpreadRenderer() {
  const { state, source, spreads, effectiveScale, bookOpenEnabled, coverOpening, onCoverSettled } =
    useFlipbookContext();
  const { currentSpreadIndex, resolvedViewMode } = state;

  // 0-page documents: spreads is empty, and source.getPageSize(0) would crash
  // (PdfjsSource.pageSizes is [] → returns undefined → .width throws TypeError).
  // Early return before any getPageSize call.
  if (spreads.length === 0) return null;

  // Render window: current ± overscan, clamped to [0, spreads.length - 1]
  const overscan = 1;
  const windowStart = Math.max(0, currentSpreadIndex - overscan);
  const windowEnd = Math.min(spreads.length - 1, currentSpreadIndex + overscan);

  // Canonical page size for slot dimensions (v0.1 assumes uniform pages)
  const pageSize = source.getPageSize(0);
  const slotWidth = pageSize.width * effectiveScale;
  const slotHeight = pageSize.height * effectiveScale;

  const renderedSpreads: ReactNode[] = [];

  for (let i = windowStart; i <= windowEnd; i++) {
    const spread = spreads[i];
    const isCurrent = i === currentSpreadIndex;
    // The cover is the first dual-cover spread — a lone page. Only when the book-open
    // animation is active do we render it as one centred slot (that then slides on
    // navigation); otherwise it stays in the plain base 2-slot layout (page on the side).
    const isCover = resolvedViewMode === 'dual-cover' && i === 0 && bookOpenEnabled === true;
    const soloPageIndex = spread.right !== null ? spread.right : spread.left;

    const spreadStyle: CSSProperties = isCurrent
      ? { visibility: 'visible', position: 'relative' }
      : { visibility: 'hidden', position: 'absolute', inset: 0 };
    if (isCover) {
      // Keep the cover the SAME width as a real 2-page spread so the stage never
      // resizes on the first flip — a resize reflow blanks a frame. The lone page is
      // centred within this full width.
      spreadStyle.minWidth = 2 * slotWidth;
    }

    // Cover-open slide: the lone cover page rests centred; while `coverOpening` it
    // slides right by half a slot into its slot (the base geometry the curl aligns to).
    // Transform the SLOT, not the spread, so it moves WITHIN the full-width spread —
    // transforming the spread itself would overflow and add a scrollbar.
    const soloSlotStyle: CSSProperties = { width: slotWidth, height: slotHeight };
    if (isCover) {
      // Animate ONLY while the cover is the visible spread. While it's hidden (pre-
      // positioned for a flip / reset after the flip), snap instantly — so the reverse
      // can park it at its slot off-screen, then slide it to centre on arrival.
      soloSlotStyle.transition = isCurrent
        ? `transform ${COVER_MOVE_MS}ms ${COVER_MOVE_EASE}`
        : 'none';
      soloSlotStyle.transform = `translateX(${coverOpening ? slotWidth / 2 : 0}px)`;
    }

    renderedSpreads.push(
      <div
        key={i}
        className="fbjs-spread"
        role="group"
        aria-roledescription="spread"
        aria-hidden={isCurrent ? undefined : true}
        style={spreadStyle}
      >
        {resolvedViewMode === 'dual-cover' && !isCover ? (
          <>
            <div className="fbjs-slot" style={{ width: slotWidth, height: slotHeight }}>
              {spread.left !== null && (
                <PageRenderer source={source} pageIndex={spread.left} scale={effectiveScale} />
              )}
            </div>
            <div className="fbjs-slot" style={{ width: slotWidth, height: slotHeight }}>
              {spread.right !== null && (
                <PageRenderer source={source} pageIndex={spread.right} scale={effectiveScale} />
              )}
            </div>
          </>
        ) : (
          // Single mode OR the dual-cover cover: one centred page. For the cover the
          // slot slides, and reports its transitionend to release the page turn.
          <div
            className="fbjs-slot"
            style={soloSlotStyle}
            onTransitionEnd={
              isCover
                ? (e) => {
                    // Confirmed cover-slide-finished → release the page turn. Guard to the
                    // slot's OWN transform (not a bubbled child / the return slide).
                    if (
                      coverOpening &&
                      e.propertyName === 'transform' &&
                      e.target === e.currentTarget
                    ) {
                      onCoverSettled?.();
                    }
                  }
                : undefined
            }
          >
            {soloPageIndex !== null && (
              <PageRenderer source={source} pageIndex={soloPageIndex} scale={effectiveScale} />
            )}
          </div>
        )}
      </div>,
    );
  }

  return <>{renderedSpreads}</>;
}
