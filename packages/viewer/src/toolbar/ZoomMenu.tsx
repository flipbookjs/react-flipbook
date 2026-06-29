import { forwardRef, memo, type ButtonHTMLAttributes } from 'react';
import { ToolbarMenu, type ToolbarMenuEntry } from './ToolbarMenu';
import { useFlipbookSelector, useFlipbookActions } from '../hooks/useFlipbook';
import { SpecialZoomLevel } from '../zoom/SpecialZoomLevel';
import { LABELS } from './labels';

export interface ZoomMenuProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | 'type' | 'disabled' | 'aria-disabled' | 'tabIndex' | 'ref'
  | 'aria-haspopup' | 'aria-expanded' | 'aria-controls' | 'aria-label'
> {
  disabled?: boolean;
  'data-testid'?: string;
}

export const ZoomMenu = memo(forwardRef<HTMLButtonElement, ZoomMenuProps>(
  function ZoomMenu(props, forwardedRef) {
    const {
      disabled,
      className: consumerClassName,
      'data-testid': rootTestId = 'fbjs-zoom-menu',
      ...rest
    } = props;

    // Single selector with shallow-equal isEqual — without it the fresh
    // object literal would !== via Object.is each render, causing ZoomMenu
    // to re-render on every store notification (page, theme, fullscreen)
    // instead of only zoom-relevant changes.
    const slice = useFlipbookSelector(
      (s) => ({
        isReady: s.status === 'ready',
        zoomMode: s.state.zoomMode,
        customScale: s.state.customScale,
        // effectiveScale is typed `number` (non-nullable). The reducer is
        // the validated boundary; SSR_STATE seeds it as 1. No `?? 1`
        // fallback — Rule 3 (no defensive coding).
        percent: s.status === 'ready'
          ? Math.round(s.state.effectiveScale * 100)
          : null,
      }),
      (a, b) =>
        a.isReady === b.isReady
        && a.zoomMode === b.zoomMode
        && a.customScale === b.customScale
        && a.percent === b.percent,
    );

    const actions = useFlipbookActions();

    const items: ToolbarMenuEntry[] = [
      {
        key: 'actualSize', label: 'Actual size',
        isCurrent: slice.zoomMode === 'custom' && slice.customScale === 1,
        onSelect: () => actions.setZoom(SpecialZoomLevel.ActualSize),
      },
      {
        key: 'pageFit', label: 'Page fit',
        isCurrent: slice.zoomMode === 'fit-page',
        onSelect: () => actions.fitPage(),
      },
      {
        key: 'pageWidth', label: 'Page width',
        isCurrent: slice.zoomMode === 'fit-width',
        onSelect: () => actions.fitWidth(),
      },
      { type: 'separator', key: 'sep1' },
      ...([0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const).map((scale) => ({
        key: `p${Math.round(scale * 100)}`,
        label: `${Math.round(scale * 100)}%`,
        isCurrent: slice.zoomMode === 'custom' && slice.customScale === scale,
        onSelect: () => actions.setZoom(scale),
      })),
    ];

    const triggerContent = slice.percent === null ? '—' : `${slice.percent}%`;
    const mergedClassName = [
      'fbjs-toolbar__readout',
      'fbjs-toolbar__readout--zoom',
      consumerClassName,
    ].filter(Boolean).join(' ');

    return (
      <>
        <ToolbarMenu
          {...rest}
          ref={forwardedRef}
          items={items}
          triggerContent={triggerContent}
          triggerAriaLabel={LABELS.zoomMenuTriggerLabel(slice.percent)}
          menuAriaLabel={LABELS.zoomMenuPopoverLabel}
          disabled={Boolean(disabled) || !slice.isReady}
          data-testid={rootTestId}
          className={mergedClassName}
        />
        <span
          role="status"
          aria-atomic="true"
          className="fbjs-sr-only"
          data-testid={`${rootTestId}-readout-live`}
        >
          {/* Verbose form (NOT the bare percent). Screen readers announce
              the full label on every aria-live update — preserves the
              "Zoom level: 87%" context that a verbose live-region
              announcement provides for screen reader users on each zoom
              change. The trigger button's aria-label uses the same
              template for focus announcements; the live region uses it
              for change announcements. */}
          {LABELS.zoomMenuTriggerLabel(slice.percent)}
        </span>
      </>
    );
  },
));
