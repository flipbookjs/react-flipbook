import { createContext, type RefObject } from 'react';

/**
 * Structural type for elements the shell will manage. The shell only calls
 * `.focus()` on registered parts — no other element methods. Using this
 * narrow type instead of `HTMLElement` enforces the constraint at compile
 * time: a future shell change that reads e.g. `target.current.value`
 * (button-or-input-specific) fails to typecheck at the registration site,
 * surfacing the contract widening immediately rather than via a runtime
 * `as` cast that erases the warning (review finding M-§3.1).
 */
export interface FocusableElement {
  focus(): void;
}

/**
 * The interface every `ToolbarShell` exposes via context. Parts call
 * `useToolbarPart()`, which consumes this context to register itself and
 * receive focus-routing callbacks.
 *
 * Methods:
 * - `registerPart(id, ref)` — idempotent: same-key re-registration overwrites
 *   the previous ref. Returns the unregister cleanup function. The shell sets
 *   `activeId = id` on the FIRST registration so Tab into the toolbar always
 *   lands on a real element. Ref is typed as `RefObject<FocusableElement | null>`
 *   so callers can pass any element-typed ref (HTMLButtonElement,
 *   HTMLAnchorElement, etc.) while the shell is statically restricted to
 *   `.focus()`-only access.
 * - `activeId` — the id of the part with `tabIndex={0}`. All other parts have
 *   `tabIndex={-1}`. Updated via `setActiveId` on `focus` events from parts.
 * - `focusFirst` / `focusLast` / `focusNext` / `focusPrevious` — called by
 *   `useToolbarPart`'s `onKeyDown` when the user presses Home / End / Arrow
 *   keys. The shell scans `partsRef.current` in insertion order to determine
 *   the target.
 *
 * Why expose the focus-routing callbacks on the context (vs. having
 * `useToolbarPart` reach into a shell-internal registry directly): the hook
 * stays decoupled from the shell's internal data structure. If a future
 * version replaces the `Map<id, ref>` with a different store (e.g., a
 * `Set` of ordered RefObjects), the hook surface doesn't change.
 */
export interface ToolbarShellContextValue {
  registerPart: (id: string, ref: RefObject<FocusableElement | null>) => () => void;
  activeId: string | null;
  setActiveId: (id: string) => void;
  focusFirst: () => void;
  focusLast: () => void;
  focusNext: (currentId: string) => void;
  focusPrevious: (currentId: string) => void;
}

/**
 * The context itself. `null` default value signals "part used outside a shell"
 * — `useToolbarPart` checks for this and falls back to standalone behavior
 * (no roving-tabindex, just normal focusable button).
 */
export const ToolbarShellContext = createContext<ToolbarShellContextValue | null>(null);
