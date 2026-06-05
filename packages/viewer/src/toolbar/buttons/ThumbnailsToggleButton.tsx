import { forwardRef, memo, useMemo, type ButtonHTMLAttributes } from 'react';
import { useFlipbookActions, useFlipbookSelector } from '../../hooks/useFlipbook';
import { useToolbarPart } from '../useToolbarPart';
import { composeHandlers, composeKeyDownHandlers } from '../composeHandlers';
import { mergeRefs } from '../mergeRefs';
import { ThumbnailsToggleIcon } from '../icons';
import { LABELS } from '../labels';

/**
 * Toggles the built-in thumbnail panel via `actions.toggleThumbnails`.
 *
 * **Toggle semantics via `aria-pressed`**: aria-label stays constant
 * ("Toggle thumbnails"); aria-pressed=true means the panel is open. Mirrors
 * the SelectionModeButton / ThemeToggleButton convention from 6B (toggle-
 * by-aria-pressed, not by aria-label flipping).
 *
 * Also sets `aria-expanded` — signals "this button controls an expandable
 * region" per WAI-ARIA APG. Mirrors the pressed state.
 *
 * `aria-controls` is NOT set. The master plan does not mandate it for the
 * thumbnail toggle; AT users navigate DOM tree order instead.
 *
 * Not disabled by `status` — like ThemeToggleButton, the toggle is a viewer-
 * chrome setting independent of source readiness. The user can pre-open the
 * panel while the document is still loading; thumbnails will appear when
 * the source becomes ready.
 */
export const ThumbnailsToggleButton = memo(forwardRef<HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-pressed' | 'tabIndex' | 'ref'>
>(function ThumbnailsToggleButton(props, forwardedRef) {
  const { ref: internalRef, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  const actions = useFlipbookActions();
  const isOpen = useFlipbookSelector((s) => s.state.thumbnailsOpen, Object.is);
  const {
    className,
    'aria-label': ariaLabel = LABELS.thumbnailsToggle,
    onClick,
    onFocus: consumerOnFocus,
    onKeyDown: consumerOnKeyDown,
    ...rest
  } = props;
  const composedClassName = ['fbjs-toolbar__button', className].filter(Boolean).join(' ');
  // ThumbnailsToggleButton is never disabled, so no aria-disabled or guard
  // needed — matches ThemeToggleButton.
  const handleClick = composeHandlers(() => { actions.toggleThumbnails(); }, onClick);
  const handleFocus = composeHandlers(onFocus, consumerOnFocus);
  const handleKeyDown = composeKeyDownHandlers(onKeyDown, consumerOnKeyDown);
  const ref = useMemo(() => mergeRefs(internalRef, forwardedRef), [internalRef, forwardedRef]);
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      aria-pressed={isOpen}
      aria-expanded={isOpen}
      data-testid="fbjs-thumbnails-toggle-button"
      className={composedClassName}
      onClick={handleClick}
      tabIndex={tabIndex}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      <ThumbnailsToggleIcon />
    </button>
  );
}));
