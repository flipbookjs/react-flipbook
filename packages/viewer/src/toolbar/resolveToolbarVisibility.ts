/**
 * Pure derivation of per-part visibility for the built-in `<Toolbar>`. Takes
 * consumer-provided visibility props + a narrow snapshot slice and returns a
 * fully-resolved record. No React, no side effects.
 *
 * Each consumer prop is optional. When the consumer passes `undefined`, the
 * per-field default rule applies. When the consumer passes `true` or `false`,
 * the consumer's value wins unconditionally — even if the default rule says
 * otherwise. The override-unconditionally semantic lets consumers force-show
 * a part during loading (`showDownload={true}` despite `canDownload=false`)
 * or hide a part permanently (`showFullScreen={false}` despite browser
 * support).
 *
 * Default rules per field:
 * - `showPrint`: true (always visible by default; consumer can hide)
 * - `showDownload`: `slice.canDownload` (false in 6A until 6F lands the URL
 *   detection in PdfjsSource; consumer can force-show with explicit `true`)
 * - `showFullScreen`: `slice.canFullScreen` (false during SSR; true on
 *   browsers exposing the Fullscreen API; consumer can hide on supported
 *   browsers with explicit `false`)
 * - `showSelectionMode`: true (6E will refine by AND-ing with `!curlMode`
 *   when the curl-mode flag lands; 6C ships the true default)
 * - `showZoom`: true
 * - `showNavigation`: true
 *
 * Used by `<Toolbar>` after a `useFlipbookSelector` reads the slice via a
 * shallowly-compared object selector.
 */

export interface VisibilityProps {
  showPrint?: boolean;
  showDownload?: boolean;
  showFullScreen?: boolean;
  showSelectionMode?: boolean;
  showZoom?: boolean;
  showNavigation?: boolean;
}

export interface VisibilitySlice {
  canDownload: boolean;
  canFullScreen: boolean;
}

export interface ResolvedVisibility {
  showPrint: boolean;
  showDownload: boolean;
  showFullScreen: boolean;
  showSelectionMode: boolean;
  showZoom: boolean;
  showNavigation: boolean;
}

export function resolveToolbarVisibility(
  props: VisibilityProps,
  slice: VisibilitySlice,
): ResolvedVisibility {
  return {
    showPrint:         props.showPrint         ?? true,
    showDownload:      props.showDownload      ?? slice.canDownload,
    showFullScreen:    props.showFullScreen    ?? slice.canFullScreen,
    showSelectionMode: props.showSelectionMode ?? true,
    showZoom:          props.showZoom          ?? true,
    showNavigation:    props.showNavigation    ?? true,
  };
}
