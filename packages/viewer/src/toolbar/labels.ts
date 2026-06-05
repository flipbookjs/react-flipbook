/**
 * Centralized English label strings for toolbar parts. Single override surface
 * for v0.2 i18n (which will introduce a `ToolbarLabelsContext` that consumers
 * wrap their `<Flipbook>` in to provide translated labels).
 *
 * v0.1 hardcodes English. Consumers wanting different labels per-part override
 * by passing `aria-label` (for buttons) at the call site. Readouts (`PageReadout`,
 * `ZoomReadout`) generate visible text via the template functions below;
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
  zoomReadout: (percent: number) => `Zoom level: ${percent}%`,
  zoomReadoutLoading: 'Zoom level not yet available',
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
} as const;
