import {
  forwardRef, memo, useEffect, useId, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode,
} from 'react';
import { useToolbarPart } from './useToolbarPart';
import { composeHandlers } from './composeHandlers';
import { mergeRefs } from './mergeRefs';
import { CheckIcon } from './icons';
import { useIsomorphicLayoutEffect } from '../hooks/useIsomorphicLayoutEffect';

export interface ToolbarMenuItem {
  type?: 'item';
  /** Stable identifier; used for keys + per-item testid suffix. */
  key: string;
  /** Visible label. Can include icons via ReactNode. */
  label: ReactNode;
  /** True when this item represents the consumer's current selection.
   *  All matching items render a visible check-mark icon; only the FIRST
   *  match in array order also receives aria-current="true" (canonical
   *  rule — radio semantics would forbid multiple aria-checked items, but
   *  multiple items CAN map to the same domain state, e.g., "Actual size"
   *  and "100%" both fire customScale=1). Consumers control which item
   *  is canonical by ORDERING the items array. */
  isCurrent: boolean;
  /** Invoked when the item is activated. Menu closes itself; the callback
   *  should ONLY dispatch the consumer's action. */
  onSelect: () => void;
}

export interface ToolbarMenuSeparator {
  type: 'separator';
  key: string;
}

export type ToolbarMenuEntry = ToolbarMenuItem | ToolbarMenuSeparator;

export interface ToolbarMenuProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | 'type' | 'disabled' | 'aria-disabled' | 'tabIndex' | 'ref'
  | 'aria-haspopup' | 'aria-expanded' | 'aria-controls' | 'aria-label'
> {
  items: ToolbarMenuEntry[];
  /** Content rendered inside the trigger (the visible label). */
  triggerContent: ReactNode;
  /** ARIA label on the trigger. Verbose form for screen readers. */
  triggerAriaLabel: string;
  /** ARIA label on the menu container. e.g., "Zoom levels". */
  menuAriaLabel: string;
  /** Disabled state. Primitive is provider-free; consumers compose any
   *  domain-specific checks (e.g., status !== 'ready') before passing. */
  disabled?: boolean;
  /** Root data-testid; suffixes -wrapper, -trigger, -popover, -item-${key}
   *  derive from it. Multi-instance consumers MUST pass distinct roots. */
  'data-testid'?: string;
}

export const ToolbarMenu = memo(forwardRef<HTMLButtonElement, ToolbarMenuProps>(
  function ToolbarMenu(props, forwardedRef) {
    const {
      items, triggerContent, triggerAriaLabel, menuAriaLabel, disabled,
      'data-testid': rootTestId = 'fbjs-toolbar-menu',
      onClick: consumerOnClick,
      onFocus: consumerOnFocus,
      onKeyDown: consumerOnKeyDown,
      className: consumerClassName,
      ...rest
    } = props;

    const { ref: shellRef, tabIndex, onFocus: shellOnFocus, onKeyDown: shellOnKeyDown } =
      useToolbarPart<HTMLButtonElement>();

    const [isOpen, setIsOpen] = useState(false);
    const [focusedItemKey, setFocusedItemKey] = useState<string | null>(null);

    const wrapperRef = useRef<HTMLSpanElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLUListElement>(null);
    const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const popoverId = useId();

    // Canonical-current rule: first isCurrent in array order gets aria-current.
    // All other matching items get just the visible check-mark icon.
    const firstCurrentItemKey = items
      .find((i) => i.type !== 'separator' && i.isCurrent)?.key;
    // Initial focus on keyboard-open: canonical-current, else first item.
    const firstFocusableKey =
      firstCurrentItemKey
      ?? items.find((i) => i.type !== 'separator')?.key;
    // ArrowUp open target: last item.
    const lastFocusableKey = [...items].reverse()
      .find((i) => i.type !== 'separator')?.key;

    // openMenu — keyboard paths only (mouse-open leaves focus on trigger per
    // standard ARIA menubutton pattern).
    const openMenu = (opts: { focusFirstOrCurrent?: boolean; focusLast?: boolean }) => {
      setIsOpen(true);
      if (opts.focusFirstOrCurrent) setFocusedItemKey(firstFocusableKey ?? null);
      else if (opts.focusLast) setFocusedItemKey(lastFocusableKey ?? null);
    };

    // Click-outside: wrapper-containment so trigger clicks are excluded.
    // Otherwise mousedown on trigger closes the menu BEFORE the React click
    // handler toggles it, causing a re-open (the "toggle race").
    useEffect(() => {
      if (!isOpen) return;
      const onDocMouseDown = (e: globalThis.MouseEvent) => {
        const target = e.target as Node;
        if (wrapperRef.current?.contains(target)) return;
        setIsOpen(false);
      };
      document.addEventListener('mousedown', onDocMouseDown);
      return () => document.removeEventListener('mousedown', onDocMouseDown);
    }, [isOpen]);

    // Force-close when disabled flips true while open. Guard is necessary
    // for idempotency under StrictMode double-invoke + rapid prop changes.
    useEffect(() => {
      if (disabled && isOpen) setIsOpen(false);
    }, [disabled, isOpen]);

    // Focus restore — useIsomorphicLayoutEffect (NOT raw useLayoutEffect) so
    // SSR (renderToString) doesn't log "useLayoutEffect does nothing on the
    // server." The existing useToolbarPart uses the same pattern; the SSR
    // test at parts-ssr.test.tsx:65 explicitly guards against the warning.
    // On the client this is sync after commit (same as useLayoutEffect),
    // so the trigger refocuses in the same paint cycle as item unmount —
    // no document.body flash. On the server it's useEffect (no-op).
    const wasOpenRef = useRef(isOpen);
    useIsomorphicLayoutEffect(() => {
      if (wasOpenRef.current && !isOpen) triggerRef.current?.focus();
      wasOpenRef.current = isOpen;
    }, [isOpen]);

    // Focus the currently-tracked item when menu opens via keyboard.
    useIsomorphicLayoutEffect(() => {
      if (!isOpen || focusedItemKey == null) return;
      itemRefs.current.get(focusedItemKey)?.focus();
    }, [isOpen, focusedItemKey]);

    // Click handler — custom wrapper (not composeHandlers) because disabled
    // must suppress consumer onClick too.
    const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
      if (disabled) { e.preventDefault(); return; }
      setIsOpen((o) => !o);
      setFocusedItemKey(null);  // mouse-open keeps focus on trigger
      consumerOnClick?.(e);
    };

    // KeyDown handler — custom 3-way wrapper. Disabled activation keys
    // full-suppress; disabled non-activation keys still reach shell for
    // toolbar roving; enabled runs consumer → menu → shell with
    // preventDefault gating.
    const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      const isActivation = e.key === 'Enter' || e.key === ' '
        || e.key === 'ArrowDown' || e.key === 'ArrowUp';
      if (disabled) {
        if (isActivation) { e.preventDefault(); return; }
        shellOnKeyDown(e);
        return;
      }
      consumerOnKeyDown?.(e);
      if (e.defaultPrevented) return;
      // Escape on trigger while menu open → close (WAI-ARIA menubutton
      // pattern: "Escape closes menu and moves focus to menu button"). This
      // covers the mouse-open case where focus stays on the trigger — the
      // item-level Escape handler in handleItemKeyDown only fires when an
      // item has focus, so without this branch, mouse-open users can't
      // dismiss the menu with Escape.
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault(); openMenu({ focusFirstOrCurrent: true });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault(); openMenu({ focusLast: true });
        return;
      }
      shellOnKeyDown(e);
    };

    const handleFocus = composeHandlers(shellOnFocus, consumerOnFocus);
    const ref = useMemo(
      () => mergeRefs(shellRef, triggerRef, forwardedRef),
      [shellRef, forwardedRef],
    );

    const setItemRef = (key: string) => (el: HTMLButtonElement | null) => {
      if (el) itemRefs.current.set(key, el);
      else itemRefs.current.delete(key);
    };

    // Arrow nav — wrap around at start/end. Separators skipped via filter.
    const moveFocus = (direction: 1 | -1) => {
      const focusable = items.filter((i) => i.type !== 'separator');
      if (focusable.length === 0) return;
      const currentIdx = focusable.findIndex((i) => i.key === focusedItemKey);
      const nextIdx = currentIdx < 0
        ? (direction === 1 ? 0 : focusable.length - 1)
        : (currentIdx + direction + focusable.length) % focusable.length;
      setFocusedItemKey((focusable[nextIdx] as ToolbarMenuItem).key);
    };

    const handleItemKeyDown = (item: ToolbarMenuItem) => (e: KeyboardEvent<HTMLButtonElement>) => {
      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          item.onSelect();
          setIsOpen(false);
          return;
        case 'Escape':
          e.preventDefault(); setIsOpen(false); return;
        case 'Tab':
          // WAI-ARIA menu pattern: Tab inside a menu closes the menu, then
          // focus advances per the natural tab sequence. NO preventDefault
          // — we want the browser's tab-advance to fire.
          //
          // Shift+Tab from the first item: same behaviour. The focus-restore
          // useIsomorphicLayoutEffect fires synchronously after commit and refocuses
          // the trigger; the browser then advances naturally from there.
          // For forward Tab from any item: trigger gets focus, then natural
          // tab advances to whatever follows the trigger in the toolbar.
          setIsOpen(false);
          return;
        case 'ArrowDown':
          e.preventDefault(); moveFocus(1); return;
        case 'ArrowUp':
          e.preventDefault(); moveFocus(-1); return;
        case 'Home': {
          e.preventDefault();
          const first = items.find((i) => i.type !== 'separator');
          if (first) setFocusedItemKey(first.key);
          return;
        }
        case 'End': {
          e.preventDefault();
          const last = [...items].reverse().find((i) => i.type !== 'separator');
          if (last) setFocusedItemKey(last.key);
          return;
        }
      }
    };

    const triggerClassName = [
      'fbjs-toolbar__menu-trigger',
      consumerClassName,
    ].filter(Boolean).join(' ');

    return (
      <span ref={wrapperRef} className="fbjs-toolbar__menu" data-testid={`${rootTestId}-wrapper`}>
        <button
          {...rest}
          ref={ref}
          type="button"
          tabIndex={tabIndex}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? popoverId : undefined}
          aria-disabled={disabled || undefined}
          aria-label={triggerAriaLabel}
          data-testid={`${rootTestId}-trigger`}
          className={triggerClassName}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
        >
          {triggerContent}
        </button>
        {isOpen && (
          <ul
            ref={popoverRef}
            role="menu"
            id={popoverId}
            aria-label={menuAriaLabel}
            data-testid={`${rootTestId}-popover`}
            className="fbjs-toolbar__menu-popover"
          >
            {items.map((entry) => {
              if (entry.type === 'separator') {
                return <li key={entry.key} role="separator" className="fbjs-toolbar__menu-separator" />;
              }
              const item = entry;
              const isAriaCurrent = item.key === firstCurrentItemKey;
              return (
                <li key={item.key}>
                  <button
                    ref={setItemRef(item.key)}
                    type="button"
                    role="menuitem"
                    aria-current={isAriaCurrent ? 'true' : undefined}
                    tabIndex={item.key === focusedItemKey ? 0 : -1}
                    data-testid={`${rootTestId}-item-${item.key}`}
                    className={[
                      'fbjs-toolbar__menu-item',
                      item.isCurrent && 'fbjs-toolbar__menu-item--current',
                    ].filter(Boolean).join(' ')}
                    onClick={() => { item.onSelect(); setIsOpen(false); }}
                    onKeyDown={handleItemKeyDown(item)}
                  >
                    <span className="fbjs-toolbar__menu-item-check" aria-hidden="true">
                      {item.isCurrent && <CheckIcon size={16} />}
                    </span>
                    <span className="fbjs-toolbar__menu-item-label">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </span>
    );
  },
));
