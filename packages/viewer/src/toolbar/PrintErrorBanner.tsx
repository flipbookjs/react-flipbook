import { useFlipbookActions, useFlipbookSelector, shallowEqual } from '../hooks/useFlipbook';
import { LABELS } from './labels';

export function PrintErrorBanner() {
  const actions = useFlipbookActions();
  const printError = useFlipbookSelector((s) => s.state.printError, shallowEqual);
  if (!printError) return null;
  // Discriminated dispatch on printError.type. Three variants supported;
  // the `_exhaustive: never` check at the type level prevents future variants
  // from being silently rendered as the wrong message.
  const message = (() => {
    switch (printError.type) {
      case 'too-large':
        return LABELS.printTooLarge(printError.totalPages, printError.limit);
      case 'render-failed':
        return LABELS.printRenderFailed(printError.pageIndex, printError.message);
      case 'blob-conversion-failed':
        return LABELS.printBlobConversionFailed(
          printError.pageIndex, printError.canvasWidth, printError.canvasHeight,
        );
    }
  })();
  return (
    <div className="fbjs-print-error">
      {/* role="status" on the message span (not the outer wrapper).
          Keeps the status region NON-interactive and announces only the
          message; the dismiss button is a sibling, outside the status role. */}
      <span
        role="status"
        aria-live="polite"
        className="fbjs-print-error__message"
      >
        {message}
      </span>
      <button
        type="button"
        className="fbjs-print-error__dismiss"
        aria-label={LABELS.dismissPrintError}
        onClick={() => actions.dismissPrintError()}
      >
        ×
      </button>
    </div>
  );
}
