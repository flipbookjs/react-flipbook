import { useEffect, useRef, type RefObject } from 'react';
import type { FlipbookAction } from '../core/flipbookReducer';
import type { FlipbookHookActions } from './useFlipbook';
import { devWarn } from '../core/devWarn';

/**
 * Editable-element check — returns true for INPUT, TEXTAREA, SELECT, or any
 * element with `contenteditable`. Used to suppress single-character shortcuts
 * (currently `f`) when typing inside consumer-supplied form fields. Escape is
 * exempted by the caller (universal cancel key).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Viewer-scoped keyboard shortcuts. Attached to the container ref so the
 * viewer doesn't pollute the consumer app's window-level keystrokes.
 * Replaces 5C's `useKeyboard.ts`.
 *
 * Shortcuts:
 *   - ArrowLeft  → dispatch PREV_SPREAD
 *   - ArrowRight → dispatch NEXT_SPREAD
 *   - Home       → dispatch GO_TO_SPREAD index=0
 *   - End        → actions.goToLast (NOT a raw dispatch — the action layer
 *                  applies the developer-UX status guard added in Phase 5.3,
 *                  making the loading-state no-op visible via devWarn rather
 *                  than silently routing through the reducer's clamp)
 *   - Ctrl+=     → actions.zoomIn (Ctrl++)
 *   - Ctrl+-     → actions.zoomOut
 *   - Ctrl+0     → actions.fitPage
 *   - f          → actions.toggleFullScreen
 *   - Escape     → actions.exitFullScreen
 *
 * Editable-target suppression: every shortcut EXCEPT Escape is suppressed
 * when the event target is editable. Escape runs everywhere (universal
 * cancel; consumers' search-input clear behavior works alongside fullscreen
 * exit).
 *
 * pdfjs text-layer caveat: pdfjs renders selectable text in <span> elements,
 * which are NOT editable. Selecting text + pressing `f` WILL toggle fullscreen
 * (matches Adobe Reader / Chrome's built-in PDF viewer). Intentional per
 * Decision 4 of the parent plan.
 *
 * Listener-stability note: `actions` and `dispatch` are read inside the handler
 * via refs; the effect deps narrow to `[containerRef]`, which has stable
 * identity from `useRef`. Net result: the keydown listener attaches once on
 * mount and detaches once on unmount — source rotation (which changes
 * `actions` identity AND `state.spreadCount`) does NOT trigger detach +
 * re-attach. End-key bounds come from `actionsRef.current.goToLast()`,
 * which reads `spreadCountRef` inside the provider — so the handler does
 * not need `spreadCount` as a parameter at all.
 */
export function useKeyboardShortcuts(
  containerRef: RefObject<HTMLDivElement | null>,
  dispatch: (action: FlipbookAction) => void,
  actions: FlipbookHookActions,
): void {
  // Mirror `actions` into a ref so the handler reads the latest reference
  // without capturing it in the effect's closure (actions rotates on source
  // change per Decision 1). `dispatch` is React-guaranteed stable across the
  // provider's lifetime (useReducer contract), so we use it directly — Rule 3:
  // trust validated internal contracts, no redundant ref-mirroring.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      // Escape-exempt guard: every shortcut except Escape suppressed on editable targets.
      if (e.key !== 'Escape' && isEditableTarget(e.target)) return;

      // Modifier-aware Ctrl shortcuts first (so Ctrl+= doesn't fall into the bare-key branch).
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case '=':
          case '+':
            e.preventDefault();
            actionsRef.current.zoomIn();
            return;
          case '-':
            e.preventDefault();
            actionsRef.current.zoomOut();
            return;
          case '0':
            e.preventDefault();
            actionsRef.current.fitPage();
            return;
        }
        // Other Ctrl-combinations are passed through — don't intercept Ctrl+S etc.
        return;
      }

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          dispatch({ type: 'NEXT_SPREAD' });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          dispatch({ type: 'PREV_SPREAD' });
          break;
        case 'Home':
          e.preventDefault();
          dispatch({ type: 'GO_TO_SPREAD', index: 0 });
          break;
        case 'End':
          e.preventDefault();
          // Route through the action layer, NOT a raw dispatch. goToLast()
          // has the sourceStatus guard (Phase 5.3) that surfaces a dev-warning
          // when the user presses End during loading — the reducer would
          // otherwise clamp the raw `index: -1` dispatch to 0, producing a
          // silent no-op (already at spread 0) with no visible feedback.
          actionsRef.current.goToLast();
          break;
        case 'f':
          // Lowercase 'f' only — matches Decision 4's SHORTCUTS table exactly
          // ("borrowed from YouTube/Vimeo player conventions"). Two exclusions
          // follow from this: (a) Shift+F produces 'F' and is intentionally not
          // bound; (b) Caps-Lock-engaged users pressing 'f' produce 'F' and
          // are ALSO excluded — they can use the toolbar's fullscreen button
          // instead. If user feedback indicates the Caps Lock exclusion is
          // too strict, v0.2 can add `case 'F':` to match both — that's a
          // documentation-only change to Decision 4.
          e.preventDefault();
          // Fullscreen rejections (permissions denied, iframe not allowed,
          // user-gesture not detected) don't need user-facing feedback — the
          // next 'f' press tries again. But Rule 1 (fail loud): log via
          // devWarn so the failure is visible in development. Stripped from
          // production by devWarn's NODE_ENV gate.
          actionsRef.current.toggleFullScreen().catch((err) => {
            devWarn('[flipbook] keyboard: toggleFullScreen() rejected; ignoring.', err);
          });
          break;
        case 'Escape':
          // No preventDefault — Escape commonly has consumer-side meaning too
          // (close their own modal, etc.). Just exit fullscreen if active.
          // Same Rule-1 treatment as toggleFullScreen above.
          actionsRef.current.exitFullScreen().catch((err) => {
            devWarn('[flipbook] keyboard: exitFullScreen() rejected; ignoring.', err);
          });
          break;
      }
    };

    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [containerRef, dispatch]);   // `dispatch` IS in deps but is React-guaranteed stable from useReducer, so the effect still re-fires at most once per mount. `actions` is read via ref so source rotation doesn't detach/reattach.
}
