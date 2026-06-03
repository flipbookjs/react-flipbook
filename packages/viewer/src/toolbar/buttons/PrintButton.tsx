import { forwardRef, memo, useMemo, type ButtonHTMLAttributes } from 'react';
import { useFlipbookActions, useFlipbookSelector, shallowEqual } from '../../hooks/useFlipbook';
import { useToolbarPart } from '../useToolbarPart';
import { composeHandlers, composeKeyDownHandlers } from '../composeHandlers';
import { mergeRefs } from '../mergeRefs';
import { PrinterIcon } from '../icons';
import { LABELS } from '../labels';
import { devWarn } from '../../core/devWarn';

/**
 * `actions.print()` is a stub in 6A returning Promise.resolve(); 6F wires the
 * streaming-print pipeline. Disabled when already printing OR source not
 * ready. NOT a toggle button — Print is an action, not a stateful on/off.
 * No aria-pressed.
 *
 * The `.catch()` pattern matches `FullScreenButton`.
 */
export const PrintButton = memo(forwardRef<HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled' | 'aria-disabled' | 'tabIndex' | 'ref'>
>(function PrintButton(props, forwardedRef) {
  const { ref: internalRef, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  const actions = useFlipbookActions();
  const { isPrinting, ready } = useFlipbookSelector(
    (s) => ({ isPrinting: s.state.isPrinting, ready: s.status === 'ready' }),
    shallowEqual,
  );
  const isDisabled = isPrinting || !ready;
  const {
    'aria-label': ariaLabel = LABELS.print,
    className, onClick,
    onFocus: consumerOnFocus,
    onKeyDown: consumerOnKeyDown,
    ...rest
  } = props;
  const composedClassName = ['fbjs-toolbar__button', className].filter(Boolean).join(' ');
  const handleClick = composeHandlers((e) => {
    if (isDisabled) { e.preventDefault(); return; }
    actions.print().catch((err) => {
      devWarn('[flipbook] toolbar: print() rejected; ignoring.', err);
    });
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
      data-testid="fbjs-print-button"
      className={composedClassName}
      onClick={handleClick}
      tabIndex={tabIndex}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      <PrinterIcon />
    </button>
  );
}));
