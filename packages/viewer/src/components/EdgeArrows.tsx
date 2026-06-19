import { memo } from 'react';
import { useFlipbookActions, useFlipbookSelector } from '../hooks/useFlipbook';
import { ChevronLeftIcon, ChevronRightIcon } from '../toolbar/icons';
import { LABELS } from '../toolbar/labels';

/** Edge-tap navigation arrows that overlay on the viewer's left and right
 *  edges. Vertically centered; fade in on hover of the viewer area; always
 *  visible on touch devices (no hover concept). At the first / last spread
 *  the arrow goes `aria-disabled` but stays in the DOM — matches the toolbar
 *  PrevButton / NextButton convention so the user can still see where they
 *  are in the document.
 *
 *  Rendered inside `.fbjs-stage` (only when the document is in the `ready`
 *  status — the stage doesn't render during loading / error). Positioned via
 *  `.fbjs-edge-arrow` CSS (see styles/edge-arrows.css). Internal component
 *  with no extensibility surface — consumers control on/off via the
 *  `showEdgeArrows` prop on `<Flipbook />`. Keyboard navigation (← / →) is
 *  unaffected; this only adds a pointer affordance. */
export const EdgeArrows = memo(function EdgeArrows() {
  const actions = useFlipbookActions();
  const { atFirst, atLast } = useFlipbookSelector((s) => ({
    atFirst: s.status !== 'ready' || s.state.spreadIndex <= 0,
    atLast: s.status !== 'ready' || s.state.spreadIndex >= s.state.spreadCount - 1,
  }));

  const handlePrev = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (atFirst) {
      e.preventDefault();
      return;
    }
    actions.previous();
  };
  const handleNext = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (atLast) {
      e.preventDefault();
      return;
    }
    actions.next();
  };

  return (
    <>
      <button
        type="button"
        aria-label={LABELS.prevPage}
        aria-disabled={atFirst || undefined}
        data-testid="fbjs-edge-arrow-prev"
        className="fbjs-edge-arrow fbjs-edge-arrow--prev"
        onClick={handlePrev}
      >
        <ChevronLeftIcon />
      </button>
      <button
        type="button"
        aria-label={LABELS.nextPage}
        aria-disabled={atLast || undefined}
        data-testid="fbjs-edge-arrow-next"
        className="fbjs-edge-arrow fbjs-edge-arrow--next"
        onClick={handleNext}
      >
        <ChevronRightIcon />
      </button>
    </>
  );
});
