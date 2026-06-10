import { forwardRef, memo, useMemo, type ButtonHTMLAttributes } from 'react';
import { useFlipbookActions, useFlipbookSelector } from '../../hooks/useFlipbook';
import { useToolbarPart } from '../useToolbarPart';
import { composeHandlers, composeKeyDownHandlers } from '../composeHandlers';
import { mergeRefs } from '../mergeRefs';
import { MagnifyingGlassPlusIcon } from '../icons';
import { LABELS } from '../labels';

/**
 * `actions.zoomIn()` from 6A wraps the existing 5C zoom step-table — if the
 * user is already at the maximum scale, the dispatch produces the same scale
 * (no-op at the snapshot level), and `ZoomReadout`'s `Math.round(scale * 100)`
 * selector returns the same percent, so `Object.is` skips its re-render. So
 * the button does NOT need an explicit max-scale disabled check here.
 *
 * Consumer ref + event composition: same shape as `PrevButton` — see its
 * JSDoc for the contract.
 */
export const ZoomInButton = memo(forwardRef<HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled' | 'aria-disabled' | 'tabIndex' | 'ref'>
>(function ZoomInButton(props, forwardedRef) {
  const { ref: internalRef, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  const actions = useFlipbookActions();
  const isDisabled = useFlipbookSelector((s) => s.status !== 'ready');
  const {
    'aria-label': ariaLabel = LABELS.zoomIn,
    className, onClick,
    onFocus: consumerOnFocus,
    onKeyDown: consumerOnKeyDown,
    ...rest
  } = props;
  const composedClassName = ['fbjs-toolbar__button', className].filter(Boolean).join(' ');
  const handleClick = composeHandlers((e) => {
    if (isDisabled) { e.preventDefault(); return; }
    actions.zoomIn();
  }, onClick);
  const handleFocus = composeHandlers(onFocus, consumerOnFocus);
  const handleKeyDown = composeKeyDownHandlers(onKeyDown, consumerOnKeyDown);
  const ref = useMemo(() => mergeRefs(internalRef, forwardedRef), [internalRef, forwardedRef]);
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      aria-disabled={isDisabled || undefined}
      data-testid="fbjs-zoom-in-button"
      className={composedClassName}
      onClick={handleClick}
      tabIndex={tabIndex}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      <MagnifyingGlassPlusIcon />
    </button>
  );
}));
