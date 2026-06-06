import { memo, useMemo, type ReactNode } from 'react';
import { useFlipbookSelector, shallowEqual } from '../hooks/useFlipbook';
import { ToolbarShell } from './ToolbarShell';
import { PrevButton } from './buttons/PrevButton';
import { NextButton } from './buttons/NextButton';
import { ZoomInButton } from './buttons/ZoomInButton';
import { ZoomOutButton } from './buttons/ZoomOutButton';
import { FullScreenButton } from './buttons/FullScreenButton';
import { PrintButton } from './buttons/PrintButton';
import { DownloadButton } from './buttons/DownloadButton';
import { SelectionModeButton } from './buttons/SelectionModeButton';
import { ThemeToggleButton } from './buttons/ThemeToggleButton';
import { ThumbnailsToggleButton } from './buttons/ThumbnailsToggleButton';
import { PageReadout } from './readouts/PageReadout';
import { ZoomReadout } from './readouts/ZoomReadout';
import {
  resolveToolbarVisibility,
  type VisibilityProps,
  type VisibilitySlice,
} from './resolveToolbarVisibility';
import { useIsMounted } from './useIsMounted';
import { LABELS } from './labels';

/**
 * Internal props shape — includes the `position` field used by `<Flipbook>`
 * when it composes the two-bar layout. The exported public `ToolbarProps`
 * type Omits `position` so consumers writing `const props: ToolbarProps =
 * { ... }` cannot include it. JSX-level type checking against the function
 * signature still accepts `position` (TypeScript reads JSX prop types from
 * the function signature, not the explicit export), so `<Toolbar
 * position="top" />` in consumer code does type-check at the JSX site —
 * this is a known limitation of TypeScript's prop-typing model. The Omit
 * + JSDoc combination is the strongest hiding achievable without a wrapper
 * component layer; consumers reading the public type via IDE hover or
 * `React.ComponentProps<typeof Toolbar>` will see `position` but the JSDoc
 * marks it as advanced/internal.
 */
interface ToolbarPropsInternal extends VisibilityProps {
  /** When `true`, suppresses the top bar (title + output buttons). Bottom bar
   *  always renders when the wrapper itself renders. Default `false`. */
  compact?: boolean;
  /** Title node rendered in the top bar before the output-button section.
   *  Suppressed when `compact={true}`. */
  title?: ReactNode;
  /** **ADVANCED / INTERNAL** — set by `<Flipbook>`'s dispatch to position
   *  the bar as top or bottom. Consumers using `<Toolbar>` directly inside
   *  their own composition usually want the default (`'bottom'`); the
   *  two-bar layout is wired by `<Flipbook>`. Omitted from the public
   *  `ToolbarProps` type to block type-level usage. */
  position?: 'top' | 'bottom';
}

/**
 * Public props shape for `<Toolbar>`. Excludes the internal `position` field
 * (see `ToolbarPropsInternal` JSDoc for the hiding limitation).
 */
export type ToolbarProps = Omit<ToolbarPropsInternal, 'position'>;

/**
 * Built-in toolbar wrapper. Composes 6B's parts into the CMS-spec two-bar
 * layout. `<Flipbook toolbar={true}>` (or omitted prop) renders this; the
 * `<Flipbook>` component computes the top + bottom slot nodes and passes
 * them to `<FlipbookProvider>` for placement above + below the container.
 *
 * **REQUIRES `<FlipbookProvider>` (or `<Flipbook>`) in the React ancestry.**
 * Throws at runtime if rendered outside the provider (via `useFlipbookSelector`'s
 * existing context-required contract). Consumers using `<Toolbar>` directly
 * for custom composition must wrap in `<FlipbookProvider>` themselves; the
 * `<Flipbook>` consumer-facing component handles this automatically.
 *
 * `position="top"`: renders the top bar — title + output buttons (FullScreen,
 * Print, Download). Returns null when `compact={true}` (top bar suppressed).
 *
 * `position="bottom"`: renders the bottom bar — navigation + zoom +
 * selection-mode + theme-toggle. Always rendered when the wrapper itself
 * renders.
 *
 * SSR gate: `useIsMounted` returns false during the SSR pass and the first
 * client render. The wrapper returns null in both cases — toolbar appears
 * after hydration. Prevents hydration mismatch from `helpers.canFullScreen`
 * differing between server (false) and client (typically true).
 */
export const Toolbar = memo(function Toolbar({
  compact = false,
  title,
  position = 'bottom',
  enablePageCurl,
  ...visibilityProps
}: ToolbarPropsInternal) {
  const isMounted = useIsMounted();
  const slice = useFlipbookSelector<VisibilitySlice>(
    (s) => ({
      canDownload: s.helpers.canDownload,
      canFullScreen: s.helpers.canFullScreen,
      isOverflowing: s.state.isOverflowing,
    }),
    shallowEqual,
  );

  const visibility = useMemo(
    () => resolveToolbarVisibility({ ...visibilityProps, enablePageCurl }, slice),
    [
      visibilityProps.showPrint,
      visibilityProps.showDownload,
      visibilityProps.showFullScreen,
      visibilityProps.showSelectionMode,
      visibilityProps.showZoom,
      visibilityProps.showNavigation,
      enablePageCurl,
      slice,
    ],
  );

  if (!isMounted) return null;
  if (position === 'top' && compact) return null;

  if (position === 'top') {
    // Top bar — title + output buttons (FullScreen / Print / Download).
    return (
      <ToolbarShell aria-label={LABELS.toolbarTopBarLabel} className="fbjs-toolbar__bar--top">
        {title != null && <span className="fbjs-toolbar__title">{title}</span>}
        <div className="fbjs-toolbar__section fbjs-toolbar__section--right">
          {visibility.showFullScreen && <FullScreenButton />}
          {visibility.showPrint && <PrintButton />}
          {visibility.showDownload && <DownloadButton />}
        </div>
      </ToolbarShell>
    );
  }

  // Bottom bar — navigation + zoom + thumbnails + selection-mode + theme-toggle.
  return (
    <ToolbarShell aria-label={LABELS.toolbarBottomBarLabel} className="fbjs-toolbar__bar--bottom">
      {visibility.showNavigation && (
        <div className="fbjs-toolbar__section fbjs-toolbar__section--left">
          <div className="fbjs-toolbar__group">
            <PrevButton />
            <PageReadout />
            <NextButton />
          </div>
        </div>
      )}
      {visibility.showZoom && (
        <div className="fbjs-toolbar__section fbjs-toolbar__section--center">
          <div className="fbjs-toolbar__group">
            <ZoomOutButton />
            <ZoomReadout />
            <ZoomInButton />
          </div>
        </div>
      )}
      <div className="fbjs-toolbar__section fbjs-toolbar__section--right">
        <div className="fbjs-toolbar__group">
          {visibility.showThumbnails && <ThumbnailsToggleButton />}
          {visibility.showSelectionMode && (
            <SelectionModeButton disabled={visibility.selectionModeDisabled} />
          )}
          <ThemeToggleButton />
        </div>
      </div>
    </ToolbarShell>
  );
});
