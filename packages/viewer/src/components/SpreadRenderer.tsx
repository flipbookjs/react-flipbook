import type { ReactNode } from 'react';
import { useFlipbookContext } from '../core/FlipbookContext';
import { PageRenderer } from './PageRenderer';

export function SpreadRenderer() {
  const { state, source, spreads, effectiveScale } = useFlipbookContext();
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

    renderedSpreads.push(
      <div
        key={i}
        className="fbjs-spread"
        role="group"
        aria-roledescription="spread"
        aria-hidden={isCurrent ? undefined : true}
        style={isCurrent
          ? { visibility: 'visible' as const, position: 'relative' as const }
          : { visibility: 'hidden' as const, position: 'absolute' as const, inset: 0 }
        }
      >
        {resolvedViewMode === 'dual-cover' ? (
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
          // Single mode: one centered page. Spread has left: null, right: pageIndex.
          <div className="fbjs-slot" style={{ width: slotWidth, height: slotHeight }}>
            {spread.right !== null && (
              <PageRenderer source={source} pageIndex={spread.right} scale={effectiveScale} />
            )}
          </div>
        )}
      </div>,
    );
  }

  return <>{renderedSpreads}</>;
}
