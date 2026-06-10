import { forwardRef, memo, useMemo, type ButtonHTMLAttributes } from 'react';
import { useFlipbookActions, useFlipbookSelector, shallowEqual } from '../../hooks/useFlipbook';
import { useToolbarPart } from '../useToolbarPart';
import { composeHandlers, composeKeyDownHandlers } from '../composeHandlers';
import { mergeRefs } from '../mergeRefs';
import { CursorArrowRaysIcon, HandRaisedIcon } from '../icons';
import { LABELS } from '../labels';

/**
 * Toggles between selection mode ('select') and pan mode ('pan') via
 * actions.setInteractionMode.
 *
 * **Toggle semantics via `aria-pressed`**: aria-label stays constant
 * ("Toggle pan mode"); aria-pressed=true means pan is active, false means
 * selection is active. Icon visually flips for sighted users.
 *
 * **Icon convention — "current state"** (review finding T5): the displayed
 * icon represents the CURRENT mode, not the action. When in pan mode, show
 * the hand icon (the pan tool); when in selection mode, show the cursor
 * icon (the selection tool). This works because the available Heroicons
 * (cursor vs hand) are inherently STATE icons (depicting the cursor type),
 * unlike FullScreenButton's icons which are action icons. The inconsistency
 * across toggle buttons (FullScreen uses action icons, Selection/Theme use
 * state icons) is documented in Section 4.2 — aria-pressed conveys state
 * authoritatively to AT regardless of icon convention.
 */
export const SelectionModeButton = memo(forwardRef<HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-disabled' | 'aria-pressed' | 'tabIndex' | 'ref'>
>(function SelectionModeButton(props, forwardedRef) {
  const { ref: internalRef, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  const actions = useFlipbookActions();
  const { interactionMode, ready } = useFlipbookSelector(
    (s) => ({ interactionMode: s.state.interactionMode, ready: s.status === 'ready' }),
    shallowEqual,
  );
  const {
    className,
    'aria-label': ariaLabel = LABELS.selectionModeToggle,
    onClick,
    onFocus: consumerOnFocus,
    onKeyDown: consumerOnKeyDown,
    disabled: consumerDisabled,
    ...rest
  } = props;
  // `consumerDisabled` is forwarded by <Toolbar> when curl coordination
  // requires the button to render disabled (visibility.selectionModeDisabled);
  // also merges with the load-state gate so the button stays inert until the
  // source is ready.
  const isDisabled = !ready || consumerDisabled === true;
  const composedClassName = ['fbjs-toolbar__button', className].filter(Boolean).join(' ');
  const handleClick = composeHandlers((e) => {
    if (isDisabled) { e.preventDefault(); return; }
    actions.setInteractionMode(interactionMode === 'select' ? 'pan' : 'select');
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
      aria-pressed={interactionMode === 'pan'}
      aria-disabled={isDisabled || undefined}
      data-testid="fbjs-selection-mode-button"
      className={composedClassName}
      onClick={handleClick}
      tabIndex={tabIndex}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      {interactionMode === 'pan' ? <HandRaisedIcon /> : <CursorArrowRaysIcon />}
    </button>
  );
}));
