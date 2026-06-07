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
 * - `showSelectionMode`: true (always visible by default; curl coordination
 *   uses `selectionModeDisabled` instead of hiding — see below)
 * - `showZoom`: true
 * - `showNavigation`: true
 * - `showThumbnails`: true (not capability-gated; every PageSource
 *   implements `getPageSize` + `renderPage`)
 *
 * Disabled-state derivation:
 * - `selectionModeDisabled`: `(enablePageCurl ?? false) && !slice.isOverflowing`.
 *   When curl is engaged and content fits (pan would be a no-op), the button
 *   stays visible but renders in a disabled state. This replaces the v0.1
 *   "hide" approach — see D8 / KL2 for the design rationale: an empty toolbar
 *   slot reads as a bug to users; a disabled button is unambiguously
 *   "feature exists but not available now".
 *
 * Used by `<Toolbar>` after a `useFlipbookSelector` reads the slice via a
 * shallowly-compared object selector.
 */

import type { FlipbookState } from '../core/flipbookReducer';

export interface VisibilityProps {
  showPrint?: boolean;
  showDownload?: boolean;
  showFullScreen?: boolean;
  showSelectionMode?: boolean;
  showZoom?: boolean;
  showNavigation?: boolean;
  showThumbnails?: boolean;
  /** Mirrors `<Flipbook enablePageCurl>` for curl-aware toolbar disabled-state.
   *  When true, the selection-mode button renders DISABLED (not hidden) while
   *  curl is actively engaged (content fits — curl captures pointer events)
   *  and becomes enabled when zoom causes overflow (curl auto-disengages).
   *  See the resolver function's JSDoc for the per-field disabled rule.
   *  Consumers mounting `<Toolbar>` directly should forward their own
   *  `enablePageCurl` value to maintain the contract. */
  enablePageCurl?: boolean;
}

export interface VisibilitySlice {
  canDownload: boolean;
  canFullScreen: boolean;
  /** True when the container's scaled content exceeds its viewport. Read from
   *  `FlipbookHookState.isOverflowing` (the curated public mirror of the
   *  provider's derived `isOverflowing` useMemo — NOT a reducer state field).
   *  Consumed by the curl-aware `showSelectionMode` refinement. */
  isOverflowing: boolean;
  /** Current print-pipeline error (if any) — read from `state.printError`.
   *  This field is a PASSENGER on the visibility slice: it is NOT consumed by
   *  `resolveToolbarVisibility()` (which only computes `show*` booleans), it
   *  is consumed directly by `<Toolbar>`'s JSX to gate `<PrintErrorBanner>`
   *  rendering on `printError !== null && visibility.showPrint`. Bundling it
   *  on the existing slice (rather than introducing a separate selector) keeps
   *  Toolbar.tsx to a single `useFlipbookSelector` call. */
  printError: FlipbookState['printError'];
}

export interface ResolvedVisibility {
  showPrint: boolean;
  showDownload: boolean;
  showFullScreen: boolean;
  showSelectionMode: boolean;
  /** True when the selection-mode button should render in a disabled state.
   *  Derived from `(enablePageCurl ?? false) && !isOverflowing`: curl
   *  coordination keeps the button visible but inert when pan would no-op. */
  selectionModeDisabled: boolean;
  showZoom: boolean;
  showNavigation: boolean;
  showThumbnails: boolean;
}

export function resolveToolbarVisibility(
  props: VisibilityProps,
  slice: VisibilitySlice,
): ResolvedVisibility {
  return {
    showPrint:             props.showPrint         ?? true,
    showDownload:          props.showDownload      ?? slice.canDownload,
    showFullScreen:        props.showFullScreen    ?? slice.canFullScreen,
    showSelectionMode:     props.showSelectionMode ?? true,
    selectionModeDisabled: (props.enablePageCurl ?? false) && !slice.isOverflowing,
    showZoom:              props.showZoom          ?? true,
    showNavigation:        props.showNavigation    ?? true,
    showThumbnails:        props.showThumbnails    ?? true,
  };
}
