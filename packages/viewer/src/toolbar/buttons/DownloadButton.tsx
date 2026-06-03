import { forwardRef, memo, useMemo, type ButtonHTMLAttributes } from 'react';
import { useFlipbookActions, useFlipbookSelector, shallowEqual } from '../../hooks/useFlipbook';
import { useToolbarPart } from '../useToolbarPart';
import { composeHandlers, composeKeyDownHandlers } from '../composeHandlers';
import { mergeRefs } from '../mergeRefs';
import { ArrowDownTrayIcon } from '../icons';
import { LABELS } from '../labels';

/**
 * `actions.download()` is a stub (no-op) until 6F wires the source-URL or
 * fetch-as-Blob mechanism. `helpers.canDownload` is hardcoded `false` in 6A
 * — so the button renders disabled by default. Once 6F's `getSourceUrl()`
 * detection lands, `canDownload` flips per-source and the button enables.
 *
 * NOT a toggle — Download is an action. No aria-pressed.
 *
 * Synchronous click handler (download is not async at the action surface
 * — 6F's body either kicks off a download or no-ops). No catch wrapper.
 */
export const DownloadButton = memo(forwardRef<HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled' | 'aria-disabled' | 'tabIndex' | 'ref'>
>(function DownloadButton(props, forwardedRef) {
  const { ref: internalRef, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  const actions = useFlipbookActions();
  const { canDownload, ready } = useFlipbookSelector(
    (s) => ({ canDownload: s.helpers.canDownload, ready: s.status === 'ready' }),
    shallowEqual,
  );
  const isDisabled = !canDownload || !ready;
  const {
    'aria-label': ariaLabel = LABELS.download,
    className, onClick,
    onFocus: consumerOnFocus,
    onKeyDown: consumerOnKeyDown,
    ...rest
  } = props;
  const composedClassName = ['fbjs-toolbar__button', className].filter(Boolean).join(' ');
  const handleClick = composeHandlers((e) => {
    if (isDisabled) { e.preventDefault(); return; }
    actions.download();
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
      data-testid="fbjs-download-button"
      className={composedClassName}
      onClick={handleClick}
      tabIndex={tabIndex}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      <ArrowDownTrayIcon />
    </button>
  );
}));
