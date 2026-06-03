import { forwardRef, memo, useMemo, type ButtonHTMLAttributes } from 'react';
import { useFlipbookActions, useFlipbookSelector } from '../../hooks/useFlipbook';
import { useToolbarPart } from '../useToolbarPart';
import { composeHandlers, composeKeyDownHandlers } from '../composeHandlers';
import { mergeRefs } from '../mergeRefs';
import { ChevronRightIcon } from '../icons';
import { LABELS } from '../labels';

export const NextButton = memo(forwardRef<HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled' | 'aria-disabled' | 'tabIndex' | 'ref'>
>(function NextButton(props, forwardedRef) {
  const { ref: internalRef, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  const actions = useFlipbookActions();
  const isDisabled = useFlipbookSelector(
    (s) => s.status !== 'ready' || s.state.spreadIndex >= s.state.spreadCount - 1,
  );
  const {
    'aria-label': ariaLabel = LABELS.nextPage,
    className,
    onClick,
    onFocus: consumerOnFocus,
    onKeyDown: consumerOnKeyDown,
    ...rest
  } = props;
  const composedClassName = ['fbjs-toolbar__button', className].filter(Boolean).join(' ');
  const handleClick = composeHandlers((e) => {
    if (isDisabled) { e.preventDefault(); return; }
    actions.next();
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
      data-testid="fbjs-next-button"
      className={composedClassName}
      onClick={handleClick}
      tabIndex={tabIndex}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      <ChevronRightIcon />
    </button>
  );
}));
