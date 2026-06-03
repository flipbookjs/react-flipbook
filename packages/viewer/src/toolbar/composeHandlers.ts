import type { KeyboardEvent, SyntheticEvent } from 'react';

/**
 * Compose two event handlers. The library's internal handler runs FIRST so
 * the toolbar action (e.g., `actions.previous()`) dispatches before any
 * consumer-side side effect (e.g., analytics). Both run regardless of
 * preventDefault — the library's handler is what the part exists for, and
 * consumer analytics shouldn't be cancellable from inside the library.
 *
 * If the consumer wants to PREEMPT the library's action, they should NOT
 * pass `onClick` (or `onFocus`/`onKeyDown`) — they should compose their own
 * button from `useFlipbookActions()`. The compose affordance is for
 * ADDITIVE side effects only.
 *
 * **`this` binding**: composed handlers are plain functions; `this` is
 * undefined inside them. If a consumer passes a class-method reference
 * (`<PrevButton onClick={this.handleClick}>` outside an arrow context),
 * `this` will be undefined inside `handleClick`. Consumers should bind
 * (`this.handleClick.bind(this)`) or use arrow functions. Standard React
 * expectation.
 *
 * **React batching**: in React 18+, both handlers run synchronously inside
 * the same event tick; state updates from both are batched into a single
 * re-render. So a consumer's `onClick` that calls a `useState` setter
 * doesn't see the dispatched action's effects (those land in the NEXT render
 * after the batch resolves). If the consumer needs to observe post-action
 * state, they should use a `useEffect` keyed on the snapshot — not read
 * stale state inside the click handler.
 *
 * **Synthetic event lifetime**: React 17+ no longer pools synthetic events,
 * so consumers can safely hold the event reference across async boundaries
 * (`await analytics(); console.log(e.currentTarget)`). The library's
 * internal handler does NOT mutate the event.
 */
export function composeHandlers<E extends SyntheticEvent>(
  internal: (e: E) => void,
  consumer: ((e: E) => void) | undefined,
): (e: E) => void {
  if (!consumer) return internal;
  return (e: E) => {
    internal(e);
    consumer(e);
  };
}

/**
 * Compose two key handlers — CONSUMER runs FIRST. If the consumer calls
 * `e.preventDefault()`, the internal handler is SKIPPED.
 *
 * Asymmetric ordering vs `composeHandlers`. The rationale: keyboard handlers
 * compose via preventDefault propagation (a documented React + DOM contract),
 * not via after-the-fact callbacks. The internal `onKeyDown` from
 * `useToolbarPart` calls `e.preventDefault()` on ArrowRight/ArrowLeft/Home/
 * End to suppress page scroll. If we ran the internal handler first, the
 * consumer could never intercept arrow keys — review finding T3.
 *
 * Use cases this enables:
 *   - Consumer's `<PrevButton onKeyDown>` opens a submenu on ArrowRight
 *     instead of moving to the next part: call `e.preventDefault()` in the
 *     consumer handler; internal handler skipped; consumer's submenu opens.
 *   - Consumer wants to LOG arrow-key presses without intercepting them:
 *     consumer handler reads `e.key`, doesn't preventDefault; internal
 *     handler runs and performs the roving-tabindex move.
 *
 * `onClick` and `onFocus` keep the `composeHandlers` (internal-first) order
 * because they don't compose via preventDefault — there's no equivalent
 * "cancel" semantic for an action dispatch or focus update. Asymmetry
 * documented in each button's JSDoc.
 *
 * **Cancellation contract** (review finding L-§3.2): `e.preventDefault()`
 * inside the consumer's handler suppresses BOTH the internal handler AND
 * the browser's default for that key. For ArrowRight/Left/Home/End the
 * browser default IS page scroll — which the internal handler would have
 * suppressed anyway — so the net effect is "consumer takes full ownership
 * of this key event." There is NO mechanism to suppress only the internal
 * handler while preserving the browser default; if you need that
 * granularity, build a custom part from `useFlipbookActions()` instead of
 * composing onto a built-in. Consumers wanting to LOG arrow keys without
 * intercepting them should NOT preventDefault inside their handler — the
 * internal handler will still fire and execute the roving-tabindex move.
 */
export function composeKeyDownHandlers<E extends HTMLElement>(
  internal: (e: KeyboardEvent<E>) => void,
  consumer: ((e: KeyboardEvent<E>) => void) | undefined,
): (e: KeyboardEvent<E>) => void {
  if (!consumer) return internal;
  return (e: KeyboardEvent<E>) => {
    consumer(e);
    if (!e.defaultPrevented) internal(e);
  };
}
