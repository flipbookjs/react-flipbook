import { forwardRef, memo, useMemo, type ButtonHTMLAttributes } from 'react';
import { useFlipbookActions, useFlipbookSelector } from '../../hooks/useFlipbook';
import { useToolbarPart } from '../useToolbarPart';
import { composeHandlers, composeKeyDownHandlers } from '../composeHandlers';
import { mergeRefs } from '../mergeRefs';
import { ChevronLeftIcon } from '../icons';
import { LABELS } from '../labels';

/**
 * Toolbar button that dispatches `actions.previous()`. Disabled when at the
 * first spread OR when the source is not ready.
 *
 * **Consumer ref forwarding**: a consumer's `ref` is merged with the
 * library's internal ref (used by `useToolbarPart` for focus management).
 * Both refs receive the underlying `<button>`. The merged ref is wrapped
 * in `useMemo` so its identity is stable across renders — without that,
 * React would detach/re-attach the ref on every render, briefly leaving
 * `partsRef.current.get(id)?.current` as `null`.
 *
 * **Consumer event composition** — asymmetric ordering by event type:
 *   - `onClick` / `onFocus`: internal-first, then consumer (additive side
 *     effects, no cancel semantics — see `composeHandlers`).
 *   - `onKeyDown`: CONSUMER-first; internal runs only if consumer didn't
 *     `preventDefault` (see `composeKeyDownHandlers`). This lets consumers
 *     intercept arrow keys for custom UX (e.g., open a submenu instead of
 *     advancing the toolbar roving-tabindex). To REPLACE all behavior,
 *     build a custom button from `useFlipbookActions()`.
 *
 * Subscription strategy: `useFlipbookSelector` with a narrow primitive
 * selector so the button re-renders only when its disabled-state inputs
 * actually change (not on every dispatch). Without this, every NEXT_SPREAD
 * dispatch would wake every button.
 */
export const PrevButton = memo(forwardRef<HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled' | 'aria-disabled' | 'tabIndex' | 'ref'>
>(function PrevButton(props, forwardedRef) {
  const { ref: internalRef, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  const actions = useFlipbookActions();
  const isDisabled = useFlipbookSelector(
    (s) => s.status !== 'ready' || s.state.spreadIndex <= 0,
  );
  const {
    'aria-label': ariaLabel = LABELS.prevPage,
    className,
    onClick,
    onFocus: consumerOnFocus,
    onKeyDown: consumerOnKeyDown,
    ...rest
  } = props;
  const composedClassName = ['fbjs-toolbar__button', className].filter(Boolean).join(' ');
  // Disabled-state guard inside the composed click: consumer's onClick still
  // fires when disabled (so analytics can log "user clicked a disabled
  // button"); only the internal action is suppressed. Consumer can detect
  // via the event's `currentTarget.getAttribute('aria-disabled')`.
  const handleClick = composeHandlers((e) => {
    if (isDisabled) { e.preventDefault(); return; }
    actions.previous();
  }, onClick);
  const handleFocus = composeHandlers(onFocus, consumerOnFocus);
  // onKeyDown is NOT guarded by disabled — arrow keys must still navigate
  // the roving-tabindex out of the disabled button (WAI-ARIA toolbar pattern).
  const handleKeyDown = composeKeyDownHandlers(onKeyDown, consumerOnKeyDown);
  // Stable composed ref — see file-header comment about ref thrashing.
  const ref = useMemo(() => mergeRefs(internalRef, forwardedRef), [internalRef, forwardedRef]);
  // {...rest} BEFORE controlled props so consumer cannot override the
  // load-bearing internal contract (ref, tabIndex, onFocus, onKeyDown, etc).
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      aria-disabled={isDisabled || undefined}
      data-testid="fbjs-prev-button"
      className={composedClassName}
      onClick={handleClick}
      tabIndex={tabIndex}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      <ChevronLeftIcon />
    </button>
  );
}));
