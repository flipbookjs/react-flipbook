/**
 * Centralized English label strings for toolbar parts. Single override surface
 * for i18n in a future 1.x minor release (which will introduce a
 * `ToolbarLabelsContext` that consumers wrap their `<Flipbook>` in to provide
 * translated labels).
 *
 * `1.0.0` hardcodes English. Consumers wanting different labels per-part override
 * by passing `aria-label` (for buttons) at the call site. Readouts (`PageReadout`)
 * and menus (`ZoomMenu`) generate visible text via the template functions below;
 * overriding them requires forking the part via the sub-path import.
 *
 * The `LABELS` const is exported from `parts.ts` so consumer code can read
 * the current label values (e.g., for runtime introspection in a debug panel)
 * but NOT mutate them — the export is the const itself, not a setter.
 */
export const LABELS = {
  toolbarLabel: 'Document viewer controls',
  toolbarTopBarLabel: 'Document viewer top controls',
  toolbarBottomBarLabel: 'Document viewer bottom controls',
  navigationGroupLabel: 'Page navigation',
  zoomGroupLabel: 'Zoom',
  prevPage: 'Previous page',
  nextPage: 'Next page',
  pageReadout: (pageNumber: number, totalPages: number) => `Page ${pageNumber} of ${totalPages}`,
  pageReadoutLoading: 'Page not yet available',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomMenuTriggerLabel: (percent: number | null) =>
    percent === null
      ? 'Zoom menu, level not yet available'
      : `Zoom menu, current level ${percent}%`,
  zoomMenuPopoverLabel: 'Zoom levels',
  // Toggle buttons use aria-pressed (not aria-label flipping) for state — see
  // FullScreenButton/SelectionModeButton/ThemeToggleButton JSDocs. The label
  // stays constant; aria-pressed conveys the on/off state. This avoids the
  // "screen reader re-announces the label whenever state flips" UX papercut
  // (review finding N11).
  fullScreenToggle: 'Toggle fullscreen',
  print: 'Print',
  download: 'Download',
  selectionModeToggle: 'Toggle pan mode',     // aria-pressed=true → pan; false → selection
  themeToggle: 'Toggle dark theme',           // aria-pressed=true → dark; false → light
  thumbnailPanelLabel: 'Page thumbnails',
  thumbnailsToggle: 'Toggle thumbnails',
  thumbnailButton: (pageNumber: number, totalPages: number) => `Go to page ${pageNumber} of ${totalPages}`,
  printTooLarge: (totalPages: number, limit: number) =>
    `Document too large to print as one job (${totalPages} pages, limit ${limit}). Page range support coming in a future release.`,
  printRenderFailed: (pageIndex: number, message: string) =>
    `Failed to render page ${pageIndex + 1} for printing: ${message}`,
  printBlobConversionFailed: (pageIndex: number, canvasWidth: number, canvasHeight: number) =>
    `Failed to encode page ${pageIndex + 1} (canvas size ${canvasWidth}×${canvasHeight}). Try reducing printScale.`,
  dismissPrintError: 'Dismiss',
} as const;
