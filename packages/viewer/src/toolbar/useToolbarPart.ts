import { useCallback, useContext, useId, useRef, type KeyboardEvent, type RefObject } from 'react';
import { useIsomorphicLayoutEffect } from '../hooks/useIsomorphicLayoutEffect';
import { ToolbarShellContext } from './ToolbarShellContext';

/**
 * The return shape of `useToolbarPart`. Consumer parts spread these props on
 * their underlying focusable element (typically a `<button>`).
 *
 * **Generic over the element type** so consumers narrow once at the call site
 * and never need a ref-cast at the JSX site. Built-in button parts call
 * `useToolbarPart<HTMLButtonElement>()` — the returned `ref` is typed
 * `RefObject<HTMLButtonElement | null>`, suitable for `<button ref={ref}>`
 * with full TypeScript narrowing. A consumer's custom `<a>` part would call
 * `useToolbarPart<HTMLAnchorElement>()`. Default `HTMLElement` for callers
 * that don't care.
 *
 * - `ref` — attach via `ref={ref}` directly. The shell uses this ref to call
 *   `.focus()` when arrow-key navigation lands on this part.
 * - `tabIndex` — `0` when this part is the active part (the one Tab reaches
 *   first when focusing the toolbar) OR when the part is used outside a
 *   `ToolbarShell` (standalone case). `-1` for all non-active parts inside a
 *   shell.
 * - `onFocus` — call from the underlying element's `onFocus`. Updates the
 *   shell's `activeId` so mouse-click or programmatic focus correctly elects
 *   this part as the new roving-tabindex anchor.
 * - `onKeyDown` — call from the underlying element's `onKeyDown`. Handles
 *   `ArrowRight`/`ArrowLeft` (move focus to next/previous part), `Home`/`End`
 *   (jump to first/last). All other keys fall through unchanged (so `Enter`/
 *   `Space` activate the button normally). When used outside a shell, returns
 *   a no-op.
 */
export interface UseToolbarPartReturn<E extends HTMLElement = HTMLElement> {
  ref: RefObject<E | null>;
  tabIndex: 0 | -1;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent<E>) => void;
}

/**
 * StrictMode-safe registration hook for a toolbar part. Each part calls this
 * once and spreads the returned props on its focusable element.
 *
 * StrictMode safety: React StrictMode (development) double-invokes effects
 * (mount → unmount → remount) to surface cleanup bugs. The naive registration
 * pattern leaks: mount registers, unmount unregisters, remount re-registers
 * — between unmount and remount, `activeId` could briefly point at the
 * (now-removed) id and the shell briefly has no Tab landing target.
 *
 * The fix has two parts:
 * 1. `useId()` returns the SAME id across StrictMode double-invoke (id is
 *    derived from React tree position, not mount cycle).
 * 2. The shell's `registerPart` is idempotent — `partsRef.current.set(id, ref)`
 *    overwrites the previous ref entry without leaking. The remount's
 *    re-registration is a same-key insert; cleanup from the original mount
 *    correctly removes the (already-re-inserted) entry... which would be a bug
 *    if the cleanup ran AFTER the re-mount's registration.
 *
 * React's effect ordering guarantees the cleanup runs BEFORE the re-mount's
 * effect. So the sequence in StrictMode is:
 *   mount 1: registerPart(id, ref) → map.set(id, ref) → activeId election
 *   unmount: cleanup() → map.delete(id) → activeId re-election
 *   mount 2: registerPart(id, ref) → map.set(id, ref) → activeId re-election
 * Net result: one entry in the map after the double-invoke; `activeId` correct.
 *
 * `useIsomorphicLayoutEffect` (not raw `useLayoutEffect`) ensures the
 * registration completes BEFORE paint on the client, so the first paint
 * shows the correct `tabIndex` values. With `useEffect`, the first paint
 * would show all parts with `tabIndex=0` (no active part identified yet) —
 * a brief flash visible to users tabbing in immediately on mount.
 *
 * Why the isomorphic wrapper instead of raw `useLayoutEffect`: on the
 * server, raw `useLayoutEffect` triggers a React warning ("useLayoutEffect
 * does nothing on the server"). The wrapper from 6A (src/hooks/
 * useIsomorphicLayoutEffect.ts) falls back to `useEffect` when `window` is
 * undefined — silencing the warning while preserving client behavior.
 * Review finding H-§1.2.
 */
export function useToolbarPart<E extends HTMLElement = HTMLElement>(): UseToolbarPartReturn<E> {
  const id = useId();
  const shell = useContext(ToolbarShellContext);
  const ref = useRef<E | null>(null);

  // Extract `registerPart` so the effect depends on the STABLE function
  // identity (useCallback-with-[] in ToolbarShell) rather than the whole
  // `shell` object — which rotates on every activeId change because the
  // context value embeds activeId. Without this narrowing, every activeId
  // change cascades unregister→re-register across ALL parts, and the cleanup
  // re-elect path on the active part flips activeId back to the first
  // registered id during the cascade (review finding 5.3-A; surfaced by
  // parts-roving-tabindex.test.tsx).
  const registerPart = shell?.registerPart;
  useIsomorphicLayoutEffect(() => {
    if (!registerPart) return;   // standalone usage — no-op
    // Cast to the shell's narrowed RefObject — the underlying ref object is
    // the same instance; only the TypeScript narrowing differs. The shell
    // only reads `.focus()`, so a structurally-narrowed FocusableElement
    // type (review finding M-§3.1) accepts any `E extends HTMLElement` ref.
    return registerPart(id, ref as RefObject<{ focus(): void } | null>);
  }, [registerPart, id]);

  // `onFocus` updates the shell's activeId. Stable identity via useCallback
  // with [shell, id] deps. When outside a shell, no-op.
  const onFocus = useCallback(() => {
    if (!shell) return;
    shell.setActiveId(id);
  }, [shell, id]);

  // `onKeyDown` routes arrow / Home / End to the shell's focus methods. All
  // other keys fall through (no preventDefault) so the underlying button's
  // default behavior (Enter/Space activation) runs unchanged.
  const onKeyDown = useCallback((e: KeyboardEvent<E>) => {
    if (!shell) return;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        shell.focusNext(id);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        shell.focusPrevious(id);
        break;
      case 'Home':
        e.preventDefault();
        shell.focusFirst();
        break;
      case 'End':
        e.preventDefault();
        shell.focusLast();
        break;
    }
  }, [shell, id]);

  // Standalone case (outside a shell): always tabIndex=0 so the part is
  // naturally focusable. Inside a shell: 0 when active, -1 otherwise.
  const tabIndex: 0 | -1 = !shell ? 0 : (shell.activeId === id ? 0 : -1);

  return { ref, tabIndex, onFocus, onKeyDown };
}
