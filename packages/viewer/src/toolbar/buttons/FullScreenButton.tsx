import { forwardRef, memo, useMemo, type ButtonHTMLAttributes } from 'react';
import { useFlipbookActions, useFlipbookSelector, shallowEqual } from '../../hooks/useFlipbook';
import { useToolbarPart } from '../useToolbarPart';
import { composeHandlers, composeKeyDownHandlers } from '../composeHandlers';
import { mergeRefs } from '../mergeRefs';
import { ArrowsPointingOutIcon, ArrowsPointingInIcon } from '../icons';
import { LABELS } from '../labels';
import { devWarn } from '../../core/devWarn';
import { useFlipbookRefs } from '../../core/FlipbookRefsContext';

/**
 * `actions.toggleFullScreen` is a stub in 6A (returns Promise.resolve()) until
 * 6E wires the body. The button works correctly with the stub: click resolves
 * the Promise without visible effect; once 6E lands, the click toggles
 * fullscreen.
 *
 * **Toggle semantics via `aria-pressed`**: the button is a stateful toggle.
 * The aria-label stays constant ("Toggle fullscreen"); aria-pressed conveys
 * the on/off state. Screen readers announce "pressed" / "not pressed" on
 * state change instead of re-reading the label, avoiding the interrupt-
 * announcement papercut of label-flipping toggles. The icon visually flips
 * to communicate state to sighted users.
 *
 * **Icon convention — "action to take"** (review finding T5): the displayed
 * icon represents the ACTION the click would perform, NOT the current state.
 * When `isFullScreen === true`, the user sees the "exit fullscreen" icon
 * (`ArrowsPointingInIcon` — converging arrows). When `isFullScreen === false`,
 * the user sees the "enter fullscreen" icon (`ArrowsPointingOutIcon` —
 * diverging arrows). This is required because Heroicons does not ship a
 * "state of being fullscreen" / "state of being windowed" pair — only the
 * two action icons. SelectionModeButton and ThemeToggleButton use a
 * "current state" convention because their available icons (cursor vs hand,
 * sun vs moon) are inherently state representations. The inconsistency is
 * documented in Section 4.2 — aria-pressed conveys state authoritatively
 * to AT users regardless of icon convention.
 *
 * The Promise return is `.catch()`'d via devWarn (Rule 1: fail loud) so a
 * future 6E rejection (e.g., browser denies fullscreen permission) surfaces
 * in dev. **Production silent — see Section 4.2 known-limitations.** A user-
 * visible error surface (e.g., a `state.lastFullScreenError` reducer field)
 * is 6E's responsibility to design alongside the action body.
 *
 * `helpers.canFullScreen` is `false` server-side and on browsers without
 * Fullscreen API support — disables the button.
 */
export const FullScreenButton = memo(forwardRef<HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled' | 'aria-disabled' | 'aria-pressed' | 'tabIndex' | 'ref'>
>(function FullScreenButton(props, forwardedRef) {
  const { ref: internalRef, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  const actions = useFlipbookActions();
  const { lastFocusedFullScreenButtonRef } = useFlipbookRefs();
  const { isFullScreen, canFullScreen, ready } = useFlipbookSelector(
    (s) => ({
      isFullScreen: s.state.isFullScreen,
      canFullScreen: s.helpers.canFullScreen,
      ready: s.status === 'ready',
    }),
    shallowEqual,
  );
  const isDisabled = !canFullScreen || !ready;
  const {
    className,
    'aria-label': ariaLabel = LABELS.fullScreenToggle,
    onClick,
    onFocus: consumerOnFocus,
    onKeyDown: consumerOnKeyDown,
    ...rest
  } = props;
  const composedClassName = ['fbjs-toolbar__button', className].filter(Boolean).join(' ');
  const handleClick = composeHandlers((e) => {
    if (isDisabled) { e.preventDefault(); return; }
    if (internalRef.current !== null) {
      lastFocusedFullScreenButtonRef.current = internalRef.current;
    }
    actions.toggleFullScreen().catch((err) => {
      devWarn('[flipbook] toolbar: toggleFullScreen() rejected; ignoring.', err);
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
      aria-pressed={isFullScreen}
      aria-disabled={isDisabled || undefined}
      data-testid="fbjs-fullscreen-button"
      className={composedClassName}
      onClick={handleClick}
      tabIndex={tabIndex}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      {isFullScreen ? <ArrowsPointingInIcon /> : <ArrowsPointingOutIcon />}
    </button>
  );
}));
