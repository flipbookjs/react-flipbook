import { memo, type HTMLAttributes } from 'react';
import { useFlipbookSelector } from '../../hooks/useFlipbook';
import { LABELS } from '../labels';

/**
 * Zoom-percent readout. Selector returns the ROUNDED percent (primitive number)
 * so `Object.is` skips re-renders when the un-rounded scale changes by less
 * than 1% — minor zoom-step adjustments don't redundantly announce.
 *
 * Visible content is the compact form (`83%`) so the toolbar stays tight.
 * Screen-reader announced text is the verbose form (`Zoom level: 83%`) via
 * `aria-label` — atomic readouts use the label, not the text content.
 *
 * Loading-state placeholder: em-dash. The selector ALSO reads `status` so the
 * placeholder triggers correctly even though `effectiveScale` defaults to `1`
 * during loading.
 *
 * NaN guard intentionally omitted (Rule 3 — no defensive coding). The reducer
 * is the validated boundary: `FlipbookHookState.effectiveScale` is contractually
 * a finite number. If the reducer ever produces NaN, that's a reducer bug to
 * crash on at the source rather than paper over here. The em-dash placeholder
 * for non-ready state is NOT defensive — `status !== 'ready'` is a documented
 * legitimate transition, not a defended-against invariant.
 *
 * `role="status"` implies `aria-live="polite"` per ARIA spec — only one of
 * the two is needed; we use the role.
 */
export const ZoomReadout = memo(function ZoomReadout(
  props: Omit<HTMLAttributes<HTMLSpanElement>, 'role' | 'aria-atomic' | 'aria-label'>,
) {
  // Selector returns a primitive number (when ready) OR null (when not ready).
  // Object.is skips when both renders return the same primitive OR both null.
  const percent = useFlipbookSelector((s) =>
    s.status === 'ready' ? Math.round((s.state.effectiveScale ?? 1) * 100) : null,
  );
  const { className, ...rest } = props;
  const composedClassName = ['fbjs-toolbar__readout', 'fbjs-toolbar__readout--zoom', className]
    .filter(Boolean).join(' ');
  // Verbose text for screen readers via aria-label; compact visible text in
  // the span body. aria-atomic="true" ensures AT re-reads the whole label on
  // any update — important so "Zoom level: 100%" → "Zoom level: 125%" reads
  // as one announcement, not just the digit difference. Loading state uses
  // a dedicated label (not a string-replace hack) so i18n consumers can
  // translate it cleanly.
  const ariaLabel = percent !== null ? LABELS.zoomReadout(percent) : LABELS.zoomReadoutLoading;
  return (
    <span
      role="status"
      aria-atomic="true"
      aria-label={ariaLabel}
      data-testid="fbjs-zoom-readout"
      className={composedClassName}
      {...rest}
    >
      {percent !== null ? `${percent}%` : '—'}
    </span>
  );
});
