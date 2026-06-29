import { memo, type HTMLAttributes } from 'react';
import { useFlipbookSelector, shallowEqual } from '../../hooks/useFlipbook';
import { LABELS } from '../labels';

/**
 * Page-number readout — `role="status"` (implies `aria-live="polite"` per
 * ARIA spec) announces page changes to screen readers. Loading-state
 * placeholder: em-dash ('—') instead of 'Page 0 of 0' so screen readers
 * don't announce zero-data during the loading window.
 *
 * Visible content matches the announced content here because the
 * page-readout text IS reasonably compact — "Page 5 of 12" doesn't bloat
 * the toolbar.
 *
 * Does NOT call `useToolbarPart` — non-focusable per WAI-ARIA toolbar pattern
 * (only buttons participate in roving-tabindex; status text doesn't).
 *
 * Subscription strategy: object selector with shallowEqual so the readout
 * re-renders only when (status, pageNumber, totalPages) actually change.
 * `shallowEqual` from the 6A hook surface.
 */
export const PageReadout = memo(function PageReadout(
  props: Omit<HTMLAttributes<HTMLSpanElement>, 'role' | 'aria-atomic'>,
) {
  const { status, pageNumber, totalPages } = useFlipbookSelector(
    (s) => ({ status: s.status, pageNumber: s.state.pageNumber, totalPages: s.state.totalPages }),
    shallowEqual,
  );
  const { className, ...rest } = props;
  const composedClassName = ['fbjs-toolbar__readout', 'fbjs-toolbar__readout--page', className]
    .filter(Boolean).join(' ');
  const text = status === 'ready' ? LABELS.pageReadout(pageNumber, totalPages) : '—';
  // Loading-state aria-label is a dedicated translatable string, not the
  // em-dash placeholder (which screen readers may announce literally as "dash").
  const ariaLabel = status === 'ready' ? undefined : LABELS.pageReadoutLoading;
  return (
    <span
      role="status"
      aria-atomic="true"
      aria-label={ariaLabel}
      data-testid="fbjs-page-readout"
      className={composedClassName}
      {...rest}
    >
      {text}
    </span>
  );
});
