import { useCallback, useEffect, useMemo, useRef, type Dispatch, type RefObject } from 'react';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';
import { devWarn } from '../core/devWarn';
import type { FlipbookAction } from '../core/flipbookReducer';

interface UseFullScreenArgs {
  rootRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  lastFocusedFullScreenButtonRef: RefObject<HTMLButtonElement | null>;
  getFullScreenTargetRef: RefObject<((root: HTMLElement) => HTMLElement | null | undefined) | undefined>;
  onEnterFullScreenRef: RefObject<(() => void) | undefined>;
  onExitFullScreenRef: RefObject<(() => void) | undefined>;
  themeRef: RefObject<'light' | 'dark'>;
  theme: 'light' | 'dark';
  dispatch: Dispatch<FlipbookAction>;
}

interface UseFullScreenReturn {
  enterFullScreen: () => Promise<void>;
  exitFullScreen: () => Promise<void>;
  toggleFullScreen: () => Promise<void>;
  canFullScreen: boolean;
}

/**
 * Owns the Fullscreen API integration: ref-mirror reads, `mirroredTargetRef`
 * lifecycle, `fullscreenchange` listener, theme-sync effect, focus
 * restoration, unmount cleanup, and the three Promise-returning action
 * bodies.
 *
 * Callback ordering (load-bearing): on every actual transition, internal
 * state and DOM are cleaned BEFORE the consumer callback fires. Consumer
 * inspects a settled state. Failed `requestFullscreen()` fires NEITHER
 * callback (no transition, no callback).
 *
 * Consumer callbacks (`onEnterFullScreen`, `onExitFullScreen`, the
 * `getFullScreenTarget` resolver itself) are wrapped in try/catch with a
 * dev-warn. A throwing consumer callback cannot corrupt the listener or
 * leave internal state inconsistent.
 */
export function useFullScreen({
  rootRef,
  containerRef,
  lastFocusedFullScreenButtonRef,
  getFullScreenTargetRef,
  onEnterFullScreenRef,
  onExitFullScreenRef,
  themeRef,
  theme,
  dispatch,
}: UseFullScreenArgs): UseFullScreenReturn {
  const canFullScreen = useMemo(
    () => typeof document !== 'undefined' && document.fullscreenEnabled,
    [],
  );

  interface PendingTransition {
    promise: Promise<void>;
    resolve: () => void;
    reject: (err: Error) => void;
  }
  interface SavedThemeAttr {
    hadAttribute: boolean;
    previousValue: string | null;
  }

  const mirroredTargetRef = useRef<HTMLElement | null>(null);
  const committedRef = useRef<boolean>(false);
  const pendingEnterRef = useRef<PendingTransition | null>(null);
  const pendingExitRef = useRef<PendingTransition | null>(null);
  const savedThemeAttrRef = useRef<SavedThemeAttr | null>(null);

  const createPending = (): PendingTransition => {
    let resolve!: () => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  const applyMirroredTheme = (target: HTMLElement, theme: 'light' | 'dark') => {
    // Save existing attribute (if any) so the consumer's pre-existing
    // data-theme can be restored on exit — important when the ancestor
    // already has data-theme="dark" from the consumer's own theme system.
    savedThemeAttrRef.current = {
      hadAttribute: target.hasAttribute('data-theme'),
      previousValue: target.getAttribute('data-theme'),
    };
    target.setAttribute('data-theme', theme);
  };

  const restoreMirroredTheme = (target: HTMLElement) => {
    // Invariant: only called after applyMirroredTheme; savedThemeAttrRef is non-null here.
    const saved = savedThemeAttrRef.current!;
    if (saved.hadAttribute && saved.previousValue !== null) {
      target.setAttribute('data-theme', saved.previousValue);
    } else {
      target.removeAttribute('data-theme');
    }
    savedThemeAttrRef.current = null;
  };

  const resolveTarget = useCallback((): HTMLElement | null => {
    const root = rootRef.current;
    if (root === null) return null;
    const consumerResolver = getFullScreenTargetRef.current;
    if (consumerResolver == null) return root;
    let consumerTarget: HTMLElement | null | undefined;
    try {
      consumerTarget = consumerResolver(root);
    } catch (err) {
      devWarn('[flipbook] getFullScreenTarget threw; falling back to .fbjs-root:', err);
      return root;
    }
    if (consumerTarget === null) {
      devWarn('[flipbook] getFullScreenTarget returned null; falling back to .fbjs-root');
    }
    return consumerTarget ?? root;
  }, [rootRef, getFullScreenTargetRef]);

  const restoreFocus = useCallback(() => {
    const button = lastFocusedFullScreenButtonRef.current;
    if (button !== null && document.contains(button)) {
      button.focus();
      return;
    }
    containerRef.current?.focus();
  }, [lastFocusedFullScreenButtonRef, containerRef]);

  const invokeConsumerCallback = useCallback(
    (which: 'onEnterFullScreen' | 'onExitFullScreen', cb: (() => void) | null | undefined) => {
      if (cb == null) return;
      try {
        cb();
      } catch (err) {
        devWarn(`[flipbook] ${which} consumer callback threw:`, err);
      }
    },
    [],
  );

  // useIsomorphicLayoutEffect (NOT useEffect): the attribute write must
  // commit before the browser paints with the new theme. With useEffect,
  // the ancestor's data-theme would lag .fbjs-root's by one frame — a
  // visible flash where the CSS-variable cascade is inconsistent.
  useIsomorphicLayoutEffect(() => {
    if (
      mirroredTargetRef.current !== null &&
      mirroredTargetRef.current !== rootRef.current
    ) {
      mirroredTargetRef.current.setAttribute('data-theme', theme);
    }
  }, [theme, rootRef]);

  useEffect(() => {
    if (!canFullScreen) return;

    const handler = () => {
      const target = mirroredTargetRef.current;
      if (target === null) return;

      if (document.fullscreenElement === target) {
        // OUR enter committed.
        committedRef.current = true;
        dispatch({ type: 'SET_FULLSCREEN', value: true });
        invokeConsumerCallback('onEnterFullScreen', onEnterFullScreenRef.current);
        // Resolve the action's awaited Promise AFTER all side effects ran.
        pendingEnterRef.current?.resolve();
        pendingEnterRef.current = null;
        return;
      }

      if (!committedRef.current) {
        // Speculative target set but our entry never committed (another
        // instance's enter won the document slot, or unrelated fullscreen
        // activity on the page). Our pending requestFullscreen will resolve
        // or reject shortly; the catch handler rolls back speculative state
        // and rejects pendingEnterRef. Do NOT fire onExitFullScreen — no
        // exit occurred from our perspective.
        return;
      }

      // OUR exit (we were in fullscreen, now we're not).
      committedRef.current = false;
      if (savedThemeAttrRef.current !== null) {
        restoreMirroredTheme(target);
      }
      mirroredTargetRef.current = null;
      dispatch({ type: 'SET_FULLSCREEN', value: false });
      restoreFocus();
      invokeConsumerCallback('onExitFullScreen', onExitFullScreenRef.current);
      pendingExitRef.current?.resolve();
      pendingExitRef.current = null;
    };

    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
    // Refs are stable; deps narrow to the genuinely-changing identities.
  }, [canFullScreen, dispatch, restoreFocus, invokeConsumerCallback]);

  // Unmount cleanup. Splits into THREE orthogonal concerns, gated on
  // independent flags rather than `document.fullscreenElement`:
  //
  //   1. Always reject in-flight transition Promises so a consumer's
  //      `await actions.enterFullScreen()` doesn't hang past unmount.
  //   2. Callback PAIRING is gated on `committedRef.current` — only fire
  //      `onExitFullScreen` if we previously fired `onEnterFullScreen`
  //      (committedRef is the listener's enter-path writer). Using
  //      `document.fullscreenElement` here would either fire a phantom
  //      exit (browser committed but our listener hadn't run yet → no
  //      matching enter callback was fired) or swallow a needed exit
  //      (exit-in-flight where document.fullscreenElement is already
  //      null but committedRef is still true).
  //   3. DOM ROLLBACK is gated on `mirroredTargetRef.current !== null` —
  //      independently of (2), any speculative `data-theme` written by
  //      `applyMirroredTheme` must be restored even if the entry never
  //      committed, otherwise the ancestor element keeps a dirty attribute
  //      after the React subtree is gone.
  //
  // The listener's effect cleanup runs AFTER this cleanup (reverse mount
  // order: this effect mounted later, so it tears down first), so the
  // listener is still attached during this block — but we read/write our
  // own refs synchronously, and the listener won't fire from our writes.
  useEffect(() => {
    return () => {
      // (1) Reject pending in-flight transitions.
      if (pendingEnterRef.current !== null) {
        pendingEnterRef.current.reject(
          new Error('[flipbook] viewer unmounted before fullscreen enter committed'),
        );
        pendingEnterRef.current = null;
      }
      if (pendingExitRef.current !== null) {
        pendingExitRef.current.reject(
          new Error('[flipbook] viewer unmounted before fullscreen exit committed'),
        );
        pendingExitRef.current = null;
      }

      const target = mirroredTargetRef.current;
      const wasCommitted = committedRef.current;

      // (2) Callback pairing — only when we had a committed entry.
      if (wasCommitted) {
        invokeConsumerCallback('onExitFullScreen', onExitFullScreenRef.current);
        committedRef.current = false;
        // Best-effort exit at the browser level. The outer try/catch swallows
        // any synchronous throw (including .catch on a non-Promise return);
        // no inner guard needed.
        if (document.fullscreenElement !== null) {
          try {
            void document.exitFullscreen().catch(() => {});
          } catch {
            // ignore — viewer is unmounting; nothing left to recover.
          }
        }
      }

      // (3) DOM rollback — independent of committed state. Restores any
      // speculative or committed `data-theme` written via applyMirroredTheme.
      // Gate the restore on `savedThemeAttrRef`, not `target !== rootRef.current`:
      // React clears refs BEFORE passive useEffect cleanups run, so at this
      // point rootRef.current is null and the identity check would always be
      // true, even when the speculative target IS the root (no theme saved).
      if (target !== null) {
        if (savedThemeAttrRef.current !== null) {
          restoreMirroredTheme(target);
        }
        mirroredTargetRef.current = null;
      }
    };
    // Refs are stable; deps narrow to the genuinely-changing identities.
  }, [rootRef, invokeConsumerCallback]);

  // Actions are NOT async functions. An async function wraps its return
  // value in a new Promise, so `return pending.promise` from an async
  // function would NOT preserve identity (the wrapped Promise has a
  // different identity than pending.promise). Duplicate-call dedup relies
  // on returning the SAME promise reference. Non-async + explicit return
  // preserves identity (Object.is true).
  const enterFullScreen = useCallback((): Promise<void> => {
    if (!canFullScreen) {
      return Promise.reject(new Error('[flipbook] Fullscreen API not available'));
    }
    if (committedRef.current) {
      return Promise.resolve();
    }
    if (pendingEnterRef.current !== null) {
      // Dedupe: duplicate rapid calls share the same transition promise.
      return pendingEnterRef.current.promise;
    }
    if (document.fullscreenElement !== null && !committedRef.current) {
      // An unrelated element holds the current fullscreen slot (another
      // <Flipbook> instance, the consumer's app, an open <video>, etc.).
      // Do NOT call requestFullscreen on our target — that would REPLACE
      // the unrelated element's session. Return a no-op resolved Promise.
      return Promise.resolve();
    }
    const target = resolveTarget();
    if (target === null) {
      return Promise.reject(
        new Error('[flipbook] no fullscreen target available (root not mounted)'),
      );
    }

    const pending = createPending();
    pendingEnterRef.current = pending;
    mirroredTargetRef.current = target;
    if (target !== rootRef.current) {
      applyMirroredTheme(target, themeRef.current!);
    }

    // Wrap in try/catch in addition to .then's reject handler: the spec
    // allows requestFullscreen to throw synchronously (e.g., violation of
    // the user-activation requirement raises before the Promise is created).
    // A synchronous throw escapes a .then-only chain and would leave the
    // speculative refs dirty without this outer catch.
    const rollbackEnter = (err: unknown) => {
      if (savedThemeAttrRef.current !== null) {
        restoreMirroredTheme(target);
      }
      mirroredTargetRef.current = null;
      if (pendingEnterRef.current !== null) {
        pendingEnterRef.current.reject(err instanceof Error ? err : new Error(String(err)));
        pendingEnterRef.current = null;
      }
    };
    try {
      target.requestFullscreen().then(
        () => {
          // Success — listener resolves pendingEnterRef after side effects.
        },
        (err: unknown) => {
          rollbackEnter(err);
        },
      );
    } catch (err) {
      rollbackEnter(err);
    }

    return pending.promise;
  }, [canFullScreen, resolveTarget, rootRef, themeRef]);

  const exitFullScreen = useCallback((): Promise<void> => {
    if (!canFullScreen) return Promise.resolve();
    if (!committedRef.current) {
      // We don't own the current fullscreen. Do NOT call
      // document.exitFullscreen() — that would exit an unrelated session.
      return Promise.resolve();
    }
    if (pendingExitRef.current !== null) {
      return pendingExitRef.current.promise;
    }

    const pending = createPending();
    pendingExitRef.current = pending;

    const rollbackExit = (err: unknown) => {
      if (pendingExitRef.current !== null) {
        pendingExitRef.current.reject(err instanceof Error ? err : new Error(String(err)));
        pendingExitRef.current = null;
      }
    };
    // try/catch covers the same synchronous-throw risk as enterFullScreen.
    try {
      document.exitFullscreen().then(
        () => {
          // Success — listener resolves pendingExitRef after side effects.
        },
        (err: unknown) => {
          rollbackExit(err);
        },
      );
    } catch (err) {
      rollbackExit(err);
    }

    return pending.promise;
  }, [canFullScreen]);

  const toggleFullScreen = useCallback((): Promise<void> => {
    // Returns enterFullScreen() or exitFullScreen() directly so the caller
    // sees the SAME pending Promise (no async wrapper that would rebox it).
    // Gated on OUR ownership — toggling when an unrelated element owns the
    // current fullscreen attempts to enter (which the enter-action then
    // refuses via its own document.fullscreenElement guard); does NOT try
    // to exit a session we don't own.
    if (committedRef.current) {
      return exitFullScreen();
    }
    return enterFullScreen();
  }, [enterFullScreen, exitFullScreen]);

  return { enterFullScreen, exitFullScreen, toggleFullScreen, canFullScreen };
}
