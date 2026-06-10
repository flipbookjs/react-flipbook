import { computeSpreads, computeSpreadCount, getAnchorPage } from './computeSpreads';
import { MIN_SCALE, MAX_SCALE } from '../zoom/zoomingLevel';
import type { DefaultScale } from '../zoom/types';

export interface FlipbookState {
  currentSpreadIndex: number;
  pageCount: number;
  spreadCount: number;
  viewMode: 'single' | 'dual-cover' | 'auto';
  resolvedViewMode: 'single' | 'dual-cover';
  containerWidth: number;
  containerHeight: number;
  /** Zoom mode — drives whether effectiveScale comes from container fit or customScale. */
  zoomMode: 'fit-page' | 'fit-width' | 'custom';
  /** Only meaningful when zoomMode === 'custom'. Clamped to [MIN_SCALE, MAX_SCALE]. */
  customScale: number;
  // ---- Step 6A additions (Decision 1 of step-6-architectural-plan.md) ----
  /** Tracks whether the viewer is currently in fullscreen. Mirrors
   *  `document.fullscreenElement` reality via fullscreenchange events; not
   *  user-intent. Reset semantics on SOURCE_CHANGED: KEPT (browser fullscreen
   *  survives source changes; reducer must not lie). 6E owns the body. */
  isFullScreen: boolean;
  /** Current theme. Seeded by `createInitialState` from the `initialTheme`
   *  parameter (default `'light'`). 6C wires the `<Flipbook initialTheme>` prop;
   *  runtime changes via `actions.setTheme()` / `actions.toggleTheme()` (6C
   *  implements the action bodies). Reset on SOURCE_CHANGED: KEPT. */
  theme: 'light' | 'dark';
  /** Text-select vs hand-pan mode. 6E implements the pan-mode click-drag
   *  handler + the action body. Reset on SOURCE_CHANGED: KEPT (user preference). */
  interactionMode: 'select' | 'pan';
  /** True while the print render pipeline is rendering pages. 6F owns the
   *  pipeline. Reset on SOURCE_CHANGED: TRUE → FALSE (an in-flight print for
   *  the old source is invalid; the AbortController in 6F's print hook is the
   *  primary defense, this reset is the backstop). */
  isPrinting: boolean;
  /** Surface of print-pipeline errors — three variants: `'too-large'` (the
   *  `printMaxPages`-ceiling rejection), `'render-failed'` (per-page render
   *  throw including decode failures), `'blob-conversion-failed'` (canvas
   *  too large for `toBlob` or `toBlob` returned null). Cleared on dismiss
   *  click, `printErrorDismissMs` timer (effect-owned in 6F), or
   *  SOURCE_CHANGED. 6F dispatches SET_PRINT_ERROR / CLEAR_PRINT_ERROR.
   *
   *  Naming-inconsistency note: the `'too-large'` payload field is
   *  `totalPages` while this reducer's state field is `pageCount`. The two
   *  refer to the same value (total page count); the divergence is
   *  historical (6A's printError variant was designed before the broader
   *  reducer field naming settled). At error-dispatch time, the hook reads
   *  `state.pageCount` and writes it as `payload.totalPages` —
   *  `printError.totalPages` mirrors `state.pageCount` at the dispatch
   *  instant. Future readers chasing a difference will find none. */
  printError:
    | { type: 'too-large'; totalPages: number; limit: number }
    | { type: 'render-failed'; pageIndex: number; message: string }
    | { type: 'blob-conversion-failed'; pageIndex: number; canvasWidth: number; canvasHeight: number }
    | null;
  // ---- Step 6D additions ----
  /** Whether the built-in thumbnail panel is open. Toggled via
   *  `actions.setThumbnailsOpen` / `actions.toggleThumbnails`.
   *  Reset on SOURCE_CHANGED: KEPT (preserved across document changes;
   *  matches `theme` / `interactionMode`). */
  thumbnailsOpen: boolean;
}

export type FlipbookAction =
  | { type: 'GO_TO_SPREAD'; index: number }
  | { type: 'NEXT_SPREAD' }
  | { type: 'PREV_SPREAD' }
  | { type: 'SET_VIEW_MODE'; mode: 'single' | 'dual-cover' | 'auto' }
  | { type: 'CONTAINER_RESIZED'; width: number; height: number }
  | { type: 'SOURCE_CHANGED'; pageCount: number; initialSpreadIndex?: number }
  | { type: 'SET_ZOOM'; mode: 'fit-page' | 'fit-width' | 'custom'; customScale?: number }
  // ---- Step 6A additions ----
  | { type: 'SET_FULLSCREEN'; value: boolean }
  | { type: 'SET_THEME'; value: 'light' | 'dark' }
  | { type: 'SET_INTERACTION_MODE'; value: 'select' | 'pan' }
  | { type: 'SET_PRINTING'; value: boolean }
  | {
      type: 'SET_PRINT_ERROR';
      payload:
        | { type: 'too-large'; totalPages: number; limit: number }
        | { type: 'render-failed'; pageIndex: number; message: string }
        | { type: 'blob-conversion-failed'; pageIndex: number; canvasWidth: number; canvasHeight: number };
    }
  | { type: 'CLEAR_PRINT_ERROR' }
  // ---- Step 6D additions ----
  | { type: 'SET_THUMBNAILS_OPEN'; value: boolean };

export function clampSpreadIndex(index: number, spreadCount: number): number {
  if (spreadCount <= 0) return 0;
  return Math.max(0, Math.min(index, spreadCount - 1));
}

/**
 * Clamp customScale to [MIN_SCALE, MAX_SCALE]. Logs a dev-mode warning when the
 * input was out-of-range. Matches old fork's silent-clamp behavior (not reject).
 *
 * Treats NaN specially (fallback to 1 — invalid input has no meaningful clamp
 * direction). Treats ±Infinity normally — they ARE valid scale intents
 * ("zoom maximally / minimally") and clamp to MAX_SCALE / MIN_SCALE
 * respectively (F2 fix: prior draft fell-through ±Infinity to NaN handling).
 */
export function clampCustomScale(scale: number): number {
  if (Number.isNaN(scale)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[flipbook] customScale ${scale} is NaN; falling back to 1`);
    }
    return 1;
  }
  if (scale < MIN_SCALE) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[flipbook] customScale ${scale} clamped to minScale ${MIN_SCALE}`);
    }
    return MIN_SCALE;
  }
  if (scale > MAX_SCALE) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[flipbook] customScale ${scale} clamped to maxScale ${MAX_SCALE}`);
    }
    return MAX_SCALE;
  }
  return scale;
}

/**
 * Convert the public `defaultScale` prop value into the (zoomMode, customScale) pair
 * used by reducer state. Clamps at the factory boundary (Decision 6 — prevents
 * `<Flipbook defaultScale={50} />` from producing a multi-GB initial canvas).
 *
 * Resolution table:
 * - 'fit-page' → { zoomMode: 'fit-page', customScale: 1 } — customScale default
 *   (matters only if user later switches to custom without specifying value)
 * - 'fit-width' → { zoomMode: 'fit-width', customScale: 1 } — same
 * - 'ActualSize' → { zoomMode: 'custom', customScale: 1 } — SpecialZoomLevel sentinel
 * - number → { zoomMode: 'custom', customScale: clampCustomScale(number) }
 */
export function resolveDefaultScale(
  defaultScale: DefaultScale,
): { zoomMode: 'fit-page' | 'fit-width' | 'custom'; customScale: number } {
  if (defaultScale === 'fit-page' || defaultScale === 'fit-width') {
    return { zoomMode: defaultScale, customScale: 1 };
  }
  if (defaultScale === 'ActualSize') {
    return { zoomMode: 'custom', customScale: 1 };
  }
  return { zoomMode: 'custom', customScale: clampCustomScale(defaultScale) };
}

export function createInitialState(
  viewMode: 'single' | 'dual-cover' | 'auto' = 'auto',
  defaultScale: DefaultScale = 'fit-page',
  initialTheme: 'light' | 'dark' = 'light',
): FlipbookState {
  const resolvedViewMode = viewMode === 'auto' ? 'single' : viewMode;
  const { zoomMode, customScale } = resolveDefaultScale(defaultScale);
  return {
    currentSpreadIndex: 0,
    pageCount: 0,
    spreadCount: 0,
    viewMode,
    resolvedViewMode,
    containerWidth: 0,
    containerHeight: 0,
    zoomMode,
    customScale,
    // ---- Step 6A additions ----
    isFullScreen: false,
    theme: initialTheme,
    interactionMode: 'select',
    isPrinting: false,
    printError: null,
    // ---- Step 6D additions ----
    thumbnailsOpen: false,
  };
}

function resolveViewMode(
  viewMode: 'single' | 'dual-cover' | 'auto',
  containerWidth: number,
): 'single' | 'dual-cover' {
  if (viewMode === 'auto') {
    return containerWidth >= 768 ? 'dual-cover' : 'single';
  }
  return viewMode;
}

function transitionViewMode(
  state: FlipbookState,
  newResolved: 'single' | 'dual-cover',
): { resolvedViewMode: 'single' | 'dual-cover'; spreadCount: number; currentSpreadIndex: number } {
  const oldSpreads = computeSpreads(state.pageCount, state.resolvedViewMode);
  const oldSpread = oldSpreads[state.currentSpreadIndex];
  const anchorPage = oldSpread ? getAnchorPage(oldSpread) : 0;

  const newSpreadCount = computeSpreadCount(state.pageCount, newResolved);
  const newSpreads = computeSpreads(state.pageCount, newResolved);
  const newIndex = newSpreads.findIndex(
    s => s.left === anchorPage || s.right === anchorPage,
  );

  return {
    resolvedViewMode: newResolved,
    spreadCount: newSpreadCount,
    currentSpreadIndex: clampSpreadIndex(newIndex, newSpreadCount),
  };
}

export function flipbookReducer(state: FlipbookState, action: FlipbookAction): FlipbookState {
  switch (action.type) {
    case 'NEXT_SPREAD':
      return {
        ...state,
        currentSpreadIndex: clampSpreadIndex(state.currentSpreadIndex + 1, state.spreadCount),
      };

    case 'PREV_SPREAD':
      return {
        ...state,
        currentSpreadIndex: clampSpreadIndex(state.currentSpreadIndex - 1, state.spreadCount),
      };

    case 'GO_TO_SPREAD':
      return {
        ...state,
        currentSpreadIndex: clampSpreadIndex(action.index, state.spreadCount),
      };

    case 'SET_VIEW_MODE': {
      const newResolved = resolveViewMode(action.mode, state.containerWidth);
      if (newResolved === state.resolvedViewMode) {
        return { ...state, viewMode: action.mode };
      }
      return {
        ...state,
        viewMode: action.mode,
        ...transitionViewMode(state, newResolved),
      };
    }

    case 'CONTAINER_RESIZED': {
      const newResolved = resolveViewMode(state.viewMode, action.width);
      if (newResolved === state.resolvedViewMode) {
        return { ...state, containerWidth: action.width, containerHeight: action.height };
      }
      return {
        ...state,
        containerWidth: action.width,
        containerHeight: action.height,
        ...transitionViewMode(state, newResolved),
      };
    }

    case 'SOURCE_CHANGED': {
      const newSpreadCount = computeSpreadCount(action.pageCount, state.resolvedViewMode);
      // Decision 1 reset matrix: printError + isPrinting reset; theme,
      // interactionMode, isFullScreen KEPT (browser fullscreen mirrors
      // document.fullscreenElement reality; user preferences persist across
      // source changes).
      return {
        ...state,
        pageCount: action.pageCount,
        spreadCount: newSpreadCount,
        currentSpreadIndex: clampSpreadIndex(action.initialSpreadIndex ?? 0, newSpreadCount),
        printError: null,
        isPrinting: false,
      };
    }

    case 'SET_ZOOM': {
      // Validation: 'custom' mode requires a non-NaN customScale; others ignore it.
      // ±Infinity is valid (clamps to MIN_SCALE / MAX_SCALE inside clampCustomScale).
      // Only NaN is genuinely invalid — no meaningful clamp direction.
      if (action.mode === 'custom') {
        if (action.customScale === undefined || Number.isNaN(action.customScale)) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`[flipbook] SET_ZOOM with mode='custom' requires a non-NaN customScale; action ignored`);
          }
          return state;
        }
        const clamped = clampCustomScale(action.customScale);
        // Same-value short-circuit: avoid spurious re-render when wheel hits cap repeatedly.
        if (state.zoomMode === 'custom' && state.customScale === clamped) return state;
        return { ...state, zoomMode: 'custom', customScale: clamped };
      }
      // 'fit-page' or 'fit-width': preserve existing customScale (user may switch back).
      if (state.zoomMode === action.mode) return state;
      return { ...state, zoomMode: action.mode };
    }

    case 'SET_FULLSCREEN':
      if (state.isFullScreen === action.value) return state;
      return { ...state, isFullScreen: action.value };

    case 'SET_THEME':
      if (state.theme === action.value) return state;
      return { ...state, theme: action.value };

    case 'SET_THUMBNAILS_OPEN':
      if (state.thumbnailsOpen === action.value) return state;
      return { ...state, thumbnailsOpen: action.value };

    case 'SET_INTERACTION_MODE':
      if (state.interactionMode === action.value) return state;
      return { ...state, interactionMode: action.value };

    case 'SET_PRINTING':
      if (state.isPrinting === action.value) return state;
      return { ...state, isPrinting: action.value };

    case 'SET_PRINT_ERROR':
      // Re-dispatch with same payload still rotates identity — Decision 7
      // requires this so the auto-dismiss effect resets the timer on every
      // user click.
      return { ...state, printError: { ...action.payload } };

    case 'CLEAR_PRINT_ERROR':
      if (state.printError === null) return state;
      return { ...state, printError: null };
  }
}
