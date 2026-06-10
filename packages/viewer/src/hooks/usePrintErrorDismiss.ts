import { useEffect, type Dispatch } from 'react';
import type { FlipbookAction, FlipbookState } from '../core/flipbookReducer';

interface UsePrintErrorDismissArgs {
  printError: FlipbookState['printError'];
  printErrorDismissMs: number;
  dispatch: Dispatch<FlipbookAction>;
}

export function usePrintErrorDismiss({
  printError, printErrorDismissMs, dispatch,
}: UsePrintErrorDismissArgs): void {
  useEffect(() => {
    if (!printError) return;
    // Disable auto-dismiss for ANY non-positive-finite value:
    //   - 0 → consumer explicit "never auto-dismiss"
    //   - Infinity / -Infinity → also "never auto-dismiss"
    //   - NaN → guarded same as Infinity (treated as disabled, not as 0ms)
    //   - negative numbers → guarded (would otherwise immediately fire setTimeout)
    // Only positive finite values schedule the timer.
    if (!Number.isFinite(printErrorDismissMs) || printErrorDismissMs <= 0) return;
    const id = setTimeout(() => dispatch({ type: 'CLEAR_PRINT_ERROR' }), printErrorDismissMs);
    return () => clearTimeout(id);
  }, [printError, printErrorDismissMs, dispatch]);
}
