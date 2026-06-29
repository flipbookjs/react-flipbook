// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, useCallback, type ReactNode, type RefObject } from 'react';
import {
  ToolbarMenu,
  type ToolbarMenuItem,
  type ToolbarMenuSeparator,
  type ToolbarMenuEntry,
} from '../toolbar/ToolbarMenu';
import {
  ToolbarShellContext,
  type FocusableElement,
  type ToolbarShellContextValue,
} from '../toolbar/ToolbarShellContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Synthetic item with sensible defaults. `onSelect` is a vi.fn() per item. */
function makeItem(key: string, overrides: Partial<ToolbarMenuItem> = {}): ToolbarMenuItem {
  return {
    key,
    label: key,
    isCurrent: false,
    onSelect: vi.fn(),
    ...overrides,
  };
}

function makeSeparator(key: string): ToolbarMenuSeparator {
  return { type: 'separator', key };
}

const defaultRequiredProps = {
  triggerContent: 'Trigger',
  triggerAriaLabel: 'Open menu',
  menuAriaLabel: 'Menu',
};

/** Convenience render — wraps the primitive with default required props. */
function renderMenu(items: ToolbarMenuEntry[], propsOverrides: Record<string, unknown> = {}) {
  return render(
    <ToolbarMenu items={items} {...defaultRequiredProps} {...propsOverrides} />,
  );
}

/** Minimal ToolbarShell stub for tests that need to verify shell-roving spy
 *  behavior (test 17d). The stub captures method calls on the shell's focus
 *  methods so the test can assert which were invoked. */
function makeShellStub() {
  const focusFirst = vi.fn();
  const focusLast = vi.fn();
  const focusNext = vi.fn();
  const focusPrevious = vi.fn();
  const partsRef = { current: new Map<string, RefObject<FocusableElement | null>>() };

  function ShellStub({ children }: { children: ReactNode }) {
    const [activeId, setActiveIdState] = useState<string | null>(null);
    const setActiveId = useCallback((id: string) => {
      setActiveIdState((prev) => (prev === id ? prev : id));
    }, []);
    const registerPart = useCallback(
      (id: string, ref: RefObject<FocusableElement | null>) => {
        partsRef.current.set(id, ref);
        setActiveIdState((prev) => (prev === null ? id : prev));
        return () => {
          partsRef.current.delete(id);
        };
      },
      [],
    );
    const value: ToolbarShellContextValue = {
      registerPart,
      activeId,
      setActiveId,
      focusFirst,
      focusLast,
      focusNext,
      focusPrevious,
    };
    return <ToolbarShellContext.Provider value={value}>{children}</ToolbarShellContext.Provider>;
  }

  return { ShellStub, focusFirst, focusLast, focusNext, focusPrevious };
}

// ---------------------------------------------------------------------------
// Group 1 — Trigger render + open/close
// ---------------------------------------------------------------------------

describe('ToolbarMenu — trigger render + open/close', () => {
  it('1. trigger renders the supplied triggerContent', () => {
    renderMenu([makeItem('a')], { triggerContent: 'Custom Label' });
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    expect(trigger).toHaveTextContent('Custom Label');
  });

  it('2. click trigger opens menu', () => {
    renderMenu([makeItem('a'), makeItem('b')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('fbjs-toolbar-menu-popover')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('fbjs-toolbar-menu-popover')).toBeInTheDocument();
  });

  it('2b. click-open keeps focus on the trigger (mouse-open semantics)', () => {
    renderMenu([makeItem('a'), makeItem('b')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it('3. click trigger again closes menu (single toggle, no re-open race)', () => {
    renderMenu([makeItem('a')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Simulate real DOM sequence (mousedown then click) to exercise the
    // click-outside wrapper-containment guard.
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('fbjs-toolbar-menu-popover')).toBeNull();
  });

  it('3b. mousedown on open trigger does not race with click handler to re-open menu', () => {
    renderMenu([makeItem('a')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');

    fireEvent.click(trigger); // open
    // Critical sequence: mousedown fires document listener; click fires onClick.
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    // After full sequence menu must be closed exactly once (no re-open).
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('4. mousedown outside wrapper closes the menu', () => {
    renderMenu([makeItem('a')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('4b. mousedown inside popover (not on item) keeps menu open', () => {
    renderMenu([makeItem('a'), makeItem('b')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.click(trigger);
    const popover = screen.getByTestId('fbjs-toolbar-menu-popover');

    fireEvent.mouseDown(popover);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('5. Escape from focused item closes the menu and restores focus to the trigger', () => {
    renderMenu([makeItem('a')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' }); // keyboard-open: focus moves into menu
    const itemA = screen.getByTestId('fbjs-toolbar-menu-item-a');
    expect(document.activeElement).toBe(itemA);

    fireEvent.keyDown(itemA, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger);
  });

  it('5b. Escape on the trigger after mouse-open closes the menu (WAI-ARIA menubutton compliance)', () => {
    renderMenu([makeItem('a')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    trigger.focus();
    fireEvent.click(trigger); // mouse-open: focus stays on trigger
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

// ---------------------------------------------------------------------------
// Group 2 — Keyboard open
// ---------------------------------------------------------------------------

describe('ToolbarMenu — keyboard open', () => {
  it('6. ArrowDown/Enter/Space open to the canonical-current item when one exists', () => {
    const items = [makeItem('a'), makeItem('b', { isCurrent: true }), makeItem('c')];
    renderMenu(items);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const itemB = screen.getByTestId('fbjs-toolbar-menu-item-b');
    expect(document.activeElement).toBe(itemB);
    expect(itemB).toHaveAttribute('aria-current', 'true');
  });

  it('7. opens to the first item when no item is current', () => {
    renderMenu([makeItem('a'), makeItem('b'), makeItem('c')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });

    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-a'));
  });

  it('8. ArrowUp opens to the last item', () => {
    renderMenu([makeItem('a'), makeItem('b'), makeItem('c')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });

    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-c'));
  });
});

// ---------------------------------------------------------------------------
// Group 3 — Arrow nav
// ---------------------------------------------------------------------------

describe('ToolbarMenu — arrow navigation', () => {
  it('9. ArrowDown wraps from last item back to first', () => {
    renderMenu([makeItem('a'), makeItem('b'), makeItem('c')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowUp' }); // open to last
    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-c'));

    fireEvent.keyDown(screen.getByTestId('fbjs-toolbar-menu-item-c'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-a'));
  });

  it('10. ArrowUp wraps from first item back to last', () => {
    renderMenu([makeItem('a'), makeItem('b'), makeItem('c')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // open to first
    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-a'));

    fireEvent.keyDown(screen.getByTestId('fbjs-toolbar-menu-item-a'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-c'));
  });

  it('11. separator is skipped during arrow navigation', () => {
    const items: ToolbarMenuEntry[] = [
      makeItem('a'),
      makeItem('b'),
      makeSeparator('sep'),
      makeItem('c'),
      makeItem('d'),
    ];
    renderMenu(items);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // focus item a
    fireEvent.keyDown(screen.getByTestId('fbjs-toolbar-menu-item-a'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-b'));

    // ArrowDown from 'b' MUST skip the separator and land on 'c'.
    fireEvent.keyDown(screen.getByTestId('fbjs-toolbar-menu-item-b'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-c'));
  });
});

// ---------------------------------------------------------------------------
// Group 4 — Home / End
// ---------------------------------------------------------------------------

describe('ToolbarMenu — Home / End', () => {
  it('12. Home jumps focus to the first item', () => {
    renderMenu([makeItem('a'), makeItem('b'), makeItem('c')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowUp' }); // focus last
    fireEvent.keyDown(screen.getByTestId('fbjs-toolbar-menu-item-c'), { key: 'Home' });

    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-a'));
  });

  it('13. End jumps focus to the last item', () => {
    renderMenu([makeItem('a'), makeItem('b'), makeItem('c')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // focus first
    fireEvent.keyDown(screen.getByTestId('fbjs-toolbar-menu-item-a'), { key: 'End' });

    expect(document.activeElement).toBe(screen.getByTestId('fbjs-toolbar-menu-item-c'));
  });
});

// ---------------------------------------------------------------------------
// Group 5 — Activation
// ---------------------------------------------------------------------------

describe('ToolbarMenu — activation', () => {
  it('14. Enter on the focused item invokes onSelect and closes the menu', () => {
    const items = [makeItem('a'), makeItem('b')];
    renderMenu(items);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // focus 'a'

    fireEvent.keyDown(screen.getByTestId('fbjs-toolbar-menu-item-a'), { key: 'Enter' });
    expect(items[0].onSelect).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('15. Space on the focused item invokes onSelect and closes the menu', () => {
    const items = [makeItem('a'), makeItem('b')];
    renderMenu(items);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    fireEvent.keyDown(screen.getByTestId('fbjs-toolbar-menu-item-a'), { key: ' ' });
    expect(items[0].onSelect).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('16. Mouse click on an item invokes onSelect and closes the menu', () => {
    const items = [makeItem('a'), makeItem('b')];
    renderMenu(items);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.click(trigger);

    fireEvent.click(screen.getByTestId('fbjs-toolbar-menu-item-b'));
    expect(items[1].onSelect).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

// ---------------------------------------------------------------------------
// Group 6 — Trigger disabled contract
// ---------------------------------------------------------------------------

describe('ToolbarMenu — disabled-trigger contract', () => {
  it('17. uses aria-disabled (not native disabled) when disabled prop is true', () => {
    renderMenu([makeItem('a')], { disabled: true });
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger') as HTMLButtonElement;
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    expect(trigger.disabled).toBe(false); // native disabled NOT set
  });

  it('17b. click on disabled trigger does NOT call consumer onClick', () => {
    const consumerClick = vi.fn();
    renderMenu([makeItem('a')], { disabled: true, onClick: consumerClick });
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');

    fireEvent.click(trigger);
    expect(consumerClick).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('17c. activation keys are preventDefault\'d AND do not reach the shell when disabled', () => {
    const stub = makeShellStub();
    render(
      <stub.ShellStub>
        <ToolbarMenu items={[makeItem('a')]} disabled {...defaultRequiredProps} />
      </stub.ShellStub>,
    );
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');

    for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      trigger.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(stub.focusNext).not.toHaveBeenCalled();
    expect(stub.focusPrevious).not.toHaveBeenCalled();
    expect(stub.focusFirst).not.toHaveBeenCalled();
    expect(stub.focusLast).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('17d. non-activation keys reach the shell when disabled (preserves toolbar roving)', () => {
    const stub = makeShellStub();
    render(
      <stub.ShellStub>
        <ToolbarMenu items={[makeItem('a')]} disabled {...defaultRequiredProps} />
      </stub.ShellStub>,
    );
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');

    fireEvent.keyDown(trigger, { key: 'ArrowLeft' });
    expect(stub.focusPrevious).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    expect(stub.focusNext).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(trigger, { key: 'Home' });
    expect(stub.focusFirst).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(trigger, { key: 'End' });
    expect(stub.focusLast).toHaveBeenCalledTimes(1);
  });

  it('17e. enabled consumer onKeyDown sees Enter; menu opens after (no veto)', () => {
    const consumerKeyDown = vi.fn();
    renderMenu([makeItem('a')], { onKeyDown: consumerKeyDown });
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(consumerKeyDown).toHaveBeenCalledTimes(1);
    expect(consumerKeyDown.mock.calls[0][0].key).toBe('Enter');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('17f. consumer onKeyDown can preventDefault to veto menu open', () => {
    const consumerKeyDown = vi.fn((e) => {
      e.preventDefault();
    });
    renderMenu([makeItem('a')], { onKeyDown: consumerKeyDown });
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(consumerKeyDown).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'false'); // menu DID NOT open
  });
});

// ---------------------------------------------------------------------------
// Group 7 — Tab dismissal
// ---------------------------------------------------------------------------

describe('ToolbarMenu — Tab dismissal', () => {
  it('18. Tab from a focused item closes the menu (focus advances via browser default)', () => {
    renderMenu([makeItem('a'), makeItem('b')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // open + focus 'a'

    // Tab handler in ToolbarMenu sets isOpen=false WITHOUT preventDefault.
    const ev = fireEvent.keyDown(screen.getByTestId('fbjs-toolbar-menu-item-a'), { key: 'Tab' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Tab did NOT preventDefault — browser advances focus naturally.
    expect(ev).toBe(true); // fireEvent returns true when default was NOT prevented
  });

  it('18b. Shift+Tab from focused item closes menu + restores focus to trigger', () => {
    renderMenu([makeItem('a'), makeItem('b')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const itemA = screen.getByTestId('fbjs-toolbar-menu-item-a');

    fireEvent.keyDown(itemA, { key: 'Tab', shiftKey: true });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger); // focus-restore effect refocuses trigger
  });
});

// ---------------------------------------------------------------------------
// Group 8 — aria-controls invariant
// ---------------------------------------------------------------------------

describe('ToolbarMenu — aria-controls invariant', () => {
  it('19. aria-controls is set only when the menu is open and matches the popover id', () => {
    renderMenu([makeItem('a')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');

    // Closed → no aria-controls.
    expect(trigger).not.toHaveAttribute('aria-controls');

    fireEvent.click(trigger);
    const popover = screen.getByTestId('fbjs-toolbar-menu-popover');
    const popoverId = popover.id;
    expect(popoverId).toBeTruthy();
    expect(trigger).toHaveAttribute('aria-controls', popoverId);

    fireEvent.click(trigger); // close
    expect(trigger).not.toHaveAttribute('aria-controls');
  });
});

// ---------------------------------------------------------------------------
// Group 9 — Force-close
// ---------------------------------------------------------------------------

describe('ToolbarMenu — force-close on disabled flip', () => {
  it('20. flipping disabled to true while menu is open force-closes the menu', () => {
    const { rerender } = renderMenu([makeItem('a')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    act(() => {
      rerender(
        <ToolbarMenu items={[makeItem('a')]} disabled {...defaultRequiredProps} />,
      );
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
  });

  it('20b. force-close is idempotent under rapid open + disabled-flip cycles', () => {
    const items = [makeItem('a')];
    const { rerender } = renderMenu(items);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');

    // Open, flip disabled, flip back, click again (should still work).
    fireEvent.click(trigger);
    act(() => {
      rerender(<ToolbarMenu items={items} disabled {...defaultRequiredProps} />);
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    act(() => {
      rerender(<ToolbarMenu items={items} {...defaultRequiredProps} />);
    });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    act(() => {
      rerender(<ToolbarMenu items={items} disabled {...defaultRequiredProps} />);
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

// ---------------------------------------------------------------------------
// Group 10 — Multi-instance
// ---------------------------------------------------------------------------

describe('ToolbarMenu — multi-instance', () => {
  it('21. two instances with distinct data-testid roots emit distinct trigger/popover/item testids', () => {
    render(
      <>
        <ToolbarMenu
          items={[makeItem('x'), makeItem('y')]}
          data-testid="menu-a"
          {...defaultRequiredProps}
        />
        <ToolbarMenu
          items={[makeItem('x'), makeItem('y')]}
          data-testid="menu-b"
          {...defaultRequiredProps}
        />
      </>,
    );

    const triggerA = screen.getByTestId('menu-a-trigger');
    const triggerB = screen.getByTestId('menu-b-trigger');
    expect(triggerA).not.toBe(triggerB);

    fireEvent.click(triggerA);
    fireEvent.click(triggerB);

    const popoverA = screen.getByTestId('menu-a-popover');
    const popoverB = screen.getByTestId('menu-b-popover');
    expect(popoverA).not.toBe(popoverB);
    expect(popoverA.id).not.toBe(popoverB.id);

    // Same item keys, but per-instance testids are distinct.
    expect(screen.getByTestId('menu-a-item-x')).not.toBe(screen.getByTestId('menu-b-item-x'));
    expect(screen.getByTestId('menu-a-wrapper')).not.toBe(screen.getByTestId('menu-b-wrapper'));
  });
});

// ---------------------------------------------------------------------------
// Group 11 — Touch open
// ---------------------------------------------------------------------------

describe('ToolbarMenu — touch open', () => {
  it('22. userEvent.click with pointerType=touch opens the menu', async () => {
    const user = userEvent.setup();
    renderMenu([makeItem('a')]);
    const trigger = screen.getByTestId('fbjs-toolbar-menu-trigger');

    await user.pointer({ keys: '[TouchA>]', target: trigger });
    await user.pointer({ keys: '[/TouchA]', target: trigger });

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
