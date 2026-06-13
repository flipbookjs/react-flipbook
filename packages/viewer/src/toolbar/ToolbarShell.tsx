import { forwardRef, useCallback, useMemo, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { ToolbarShellContext, type FocusableElement, type ToolbarShellContextValue } from './ToolbarShellContext';
import { LABELS } from './labels';

/**
 * The WAI-ARIA toolbar container. Renders `<div role="toolbar">` and provides
 * the registry context for child parts to call `useToolbarPart()`.
 *
 * Roving-tabindex implementation:
 * - Each registered part calls `registerPart(id, ref)` from `useToolbarPart`.
 * - `partsRef.current` is a `Map<id, ref>` keyed by stable `useId` strings.
 *   Map iteration order = insertion order = the order the parts called
 *   `useLayoutEffect` (which React fires in tree order for siblings).
 * - `activeId` (state) is the id of the part with `tabIndex={0}`. All other
 *   parts have `tabIndex={-1}` per the WAI-ARIA toolbar pattern. Initially
 *   `null`; the first `registerPart` call elects itself as the active id
 *   so Tab into the toolbar lands on a real element.
 * - `focusFirst` / `focusLast` / `focusNext` / `focusPrevious` find the
 *   target part in `partsRef`, set `activeId` to its id, and call
 *   `.focus()` on the part's ref. The focus call triggers the part's
 *   `onFocus` (which would set activeId again — idempotent, no infinite
 *   loop).
 *
 * The shell does NOT auto-layout children into "top bar" and "bottom bar"
 * sections — that's 6C's `<Toolbar>` wrapper. The shell is a single flex
 * container; consumers using the parts directly compose their own layout.
 *
 * `forwardRef` exposes the underlying `<div>` ref so consumers can scroll
 * the toolbar into view or measure its dimensions. React 19 accepts ref
 * as a regular prop, but `forwardRef` is still the React 18-compatible
 * pattern (peer dep allows `>=18.0.0`).
 */
interface ToolbarShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  children: ReactNode;
  /**
   * Custom aria-label. Defaults to `LABELS.toolbarLabel`
   * ("Document viewer controls"). Override for i18n or context-specific
   * naming. A future 1.x minor introduces a ToolbarLabelsContext for global override.
   */
  'aria-label'?: string;
}

export const ToolbarShell = forwardRef<HTMLDivElement, ToolbarShellProps>(
  function ToolbarShell(props, forwardedRef) {
    const { children, className, 'aria-label': ariaLabel = LABELS.toolbarLabel, ...rest } = props;

    // `partsRef.current` is the registry. Initialized once via useRef + lazy
    // initializer pattern (Map constructor in useRef's initial value). Never
    // re-allocated across renders — the same Map identity persists for the
    // shell's lifetime. Typed as `FocusableElement` (the structural type
    // from ToolbarShellContext) so the shell can only call `.focus()` on
    // registered refs — see M-§3.1.
    const partsRef = useRef<Map<string, RefObject<FocusableElement | null>>>(new Map());

    // `activeId` is the id of the part with tabIndex={0}. The shell's render
    // doesn't directly use it (parts read it via context), but storing it as
    // state ensures registered parts re-render when it changes — the context
    // value rotates on every state change, triggering all consumer parts to
    // re-evaluate their `tabIndex`.
    const [activeId, setActiveIdRaw] = useState<string | null>(null);

    // `setActiveId` is the public mutator exposed on the context. Wraps
    // `setActiveIdRaw` with no-op-if-unchanged behavior (React already does
    // this for setState — explicit here for clarity).
    const setActiveId = useCallback((id: string) => {
      setActiveIdRaw((prev) => (prev === id ? prev : id));
    }, []);

    // `registerPart` is idempotent: same-key insert overwrites the previous
    // ref entry. The first part registered becomes the active id so Tab into
    // the toolbar lands on a real element. Cleanup removes by id; if the
    // removed part was active, re-elect the FIRST remaining part as active.
    const registerPart = useCallback((id: string, ref: RefObject<FocusableElement | null>) => {
      partsRef.current.set(id, ref);
      // First-registration election: if no part is active, this becomes
      // the active id. The functional setter avoids capturing a stale
      // `activeId` from closure (which would happen if registerPart was
      // recreated on every render with `activeId` in its deps).
      setActiveIdRaw((prev) => (prev === null ? id : prev));
      return () => {
        partsRef.current.delete(id);
        // If the removed part was active, fall through to the first
        // remaining part. If no parts remain, set to null (the next
        // registerPart call will re-elect).
        //
        // Cascade-during-flush note (review finding M-§4.1): when MULTIPLE
        // parts unmount in the same React commit (e.g., consumer conditionally
        // removes a whole section of the toolbar in one render), this cleanup
        // runs once per unmounting part, each re-electing to the "first
        // remaining" id. The result is several intermediate setActiveIdRaw
        // calls that all get batched into a single commit by React, so the
        // user sees one re-render with the final activeId (likely `null` if
        // every part went away). Correct but wasteful — each re-election
        // does an O(1) Map.keys().next() call that's thrown away. Optimization
        // for a future 1.x minor: clear activeId to null on any active-id removal and let
        // the next registerPart re-elect. Defer; current cost is negligible
        // for 9-11 parts.
        setActiveIdRaw((prev) => {
          if (prev !== id) return prev;
          const next = partsRef.current.keys().next();
          return next.done ? null : next.value;
        });
      };
    }, []);

    // Focus helpers — scan the registry in insertion order. Implemented via
    // shared `focusById` so the four entry points share the same focus logic.
    const focusById = useCallback((targetId: string | undefined) => {
      // `targetId` undefined is a legitimate exit — `partsRef.current.keys().
      // next().value` returns undefined when the Map is empty (the shell has
      // no parts; nothing to focus). Boundary handling, NOT defensive (Rule 3).
      if (!targetId) return;
      const target = partsRef.current.get(targetId);
      // `target` undefined is a legitimate transition state: a part can call
      // focusNext/focusPrevious from a render-phase keydown handler that fires
      // BETWEEN the part's unmount-cleanup (removing from partsRef) and
      // React's commit of the cleanup. In that microscopic window, currentId
      // resolves to a key no longer in the Map. We exit silently rather than
      // crash on the consumer's keyboard interaction. `target.current` null
      // is impossible by construction (`useLayoutEffect` attaches the ref
      // before registerPart fires), but the optional-chain is free and the
      // alternative (crash on user input) is worse-than-defensive. Not a Rule
      // 3 violation: each check defends against a documented legitimate
      // transition state, not a hypothetical "what if the reducer breaks"
      // (see ZoomReadout's intentional NO-isFinite-guard for that contrast).
      if (!target?.current) return;
      target.current.focus();
      // Belt-and-suspenders: real browsers fire the focus event synchronously
      // from `.focus()`, which routes through the part's `onFocus` → `shell.
      // setActiveId(targetId)` and updates state. jsdom (used by tests) does
      // NOT reliably fire focus events from `.focus()` calls — the direct
      // write below keeps the registry consistent in tests. In real browsers
      // this is redundant: React's bailout (Object.is on setState) makes the
      // second update a no-op when state is already `targetId`. Both paths
      // converge to the same correct state; no double-render concern.
      setActiveIdRaw(targetId);
    }, []);

    const focusFirst = useCallback(() => {
      const first = partsRef.current.keys().next();
      if (first.done) return;
      focusById(first.value);
    }, [focusById]);

    const focusLast = useCallback(() => {
      let last: string | undefined;
      for (const id of partsRef.current.keys()) last = id;
      focusById(last);
    }, [focusById]);

    // ArrowRight: move to the next part in insertion order. Wraps to first
    // at the end. ArrowLeft: previous, wraps to last at the start.
    const focusNext = useCallback((currentId: string) => {
      const ids = Array.from(partsRef.current.keys());
      const idx = ids.indexOf(currentId);
      if (idx === -1) return;   // currentId not in registry (shouldn't happen)
      const next = ids[(idx + 1) % ids.length];
      focusById(next);
    }, [focusById]);

    const focusPrevious = useCallback((currentId: string) => {
      const ids = Array.from(partsRef.current.keys());
      const idx = ids.indexOf(currentId);
      if (idx === -1) return;
      const prev = ids[(idx - 1 + ids.length) % ids.length];
      focusById(prev);
    }, [focusById]);

    // The context value rotates on every `activeId` change (because activeId
    // is in the object), which is intentional: parts read `activeId` to
    // compute their `tabIndex`. The OTHER fields (registerPart, focus*) are
    // stable across renders (their useCallback deps are empty / [focusById]).
    const contextValue = useMemo<ToolbarShellContextValue>(() => ({
      registerPart,
      activeId,
      setActiveId,
      focusFirst,
      focusLast,
      focusNext,
      focusPrevious,
    }), [registerPart, activeId, setActiveId, focusFirst, focusLast, focusNext, focusPrevious]);

    const composedClassName = ['fbjs-toolbar', className].filter(Boolean).join(' ');

    return (
      <ToolbarShellContext.Provider value={contextValue}>
        <div
          ref={forwardedRef}
          role="toolbar"
          aria-label={ariaLabel}
          className={composedClassName}
          {...rest}
        >
          {children}
        </div>
      </ToolbarShellContext.Provider>
    );
  },
);
