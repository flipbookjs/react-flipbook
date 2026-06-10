import { forwardRef, memo, useMemo, type ButtonHTMLAttributes } from 'react';
import { useFlipbookActions, useFlipbookSelector } from '../../hooks/useFlipbook';
import { useToolbarPart } from '../useToolbarPart';
import { composeHandlers, composeKeyDownHandlers } from '../composeHandlers';
import { mergeRefs } from '../mergeRefs';
import { SunIcon, MoonIcon } from '../icons';
import { LABELS } from '../labels';

/**
 * Toggles theme via `actions.toggleTheme` (stub no-op until 6C).
 *
 * **Toggle semantics via `aria-pressed`**: aria-label stays "Toggle dark
 * theme"; aria-pressed=true means dark mode is on, false means light is
 * on.
 *
 * **Icon convention — "current state"** (review finding T5): shows the
 * current theme's icon (sun for light, moon for dark). Heroicons sun/moon
 * are inherently STATE icons (depicting day vs night), so the convention
 * is natural. Mirrors `SelectionModeButton`'s convention; differs from
 * `FullScreenButton` which uses action icons because Heroicons doesn't
 * ship windowed/fullscreen state icons. Documented in Section 4.2.
 *
 * Primitive selector — `state.theme` is a string union; `Object.is` skips
 * re-render when it doesn't change.
 *
 * Not disabled by `status` — theme is a viewer chrome setting independent
 * of source readiness. The user can toggle theme during loading and the
 * setting persists to the eventual ready state.
 */
export const ThemeToggleButton = memo(forwardRef<HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-pressed' | 'tabIndex' | 'ref'>
>(function ThemeToggleButton(props, forwardedRef) {
  const { ref: internalRef, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  const actions = useFlipbookActions();
  const theme = useFlipbookSelector((s) => s.state.theme);
  const {
    className,
    'aria-label': ariaLabel = LABELS.themeToggle,
    onClick,
    onFocus: consumerOnFocus,
    onKeyDown: consumerOnKeyDown,
    ...rest
  } = props;
  const composedClassName = ['fbjs-toolbar__button', className].filter(Boolean).join(' ');
  // ThemeToggleButton is never disabled, so no aria-disabled or guard needed.
  const handleClick = composeHandlers(() => { actions.toggleTheme(); }, onClick);
  const handleFocus = composeHandlers(onFocus, consumerOnFocus);
  const handleKeyDown = composeKeyDownHandlers(onKeyDown, consumerOnKeyDown);
  const ref = useMemo(() => mergeRefs(internalRef, forwardedRef), [internalRef, forwardedRef]);
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      aria-pressed={theme === 'dark'}
      data-testid="fbjs-theme-toggle-button"
      className={composedClassName}
      onClick={handleClick}
      tabIndex={tabIndex}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    >
      {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}));
