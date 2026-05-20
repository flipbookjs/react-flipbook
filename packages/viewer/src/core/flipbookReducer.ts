import { computeSpreads, computeSpreadCount, getAnchorPage } from './computeSpreads';

export interface FlipbookState {
  currentSpreadIndex: number;
  pageCount: number;
  spreadCount: number;
  viewMode: 'single' | 'dual-cover' | 'auto';
  resolvedViewMode: 'single' | 'dual-cover';
  containerWidth: number;
  containerHeight: number;
}

export type FlipbookAction =
  | { type: 'GO_TO_SPREAD'; index: number }
  | { type: 'NEXT_SPREAD' }
  | { type: 'PREV_SPREAD' }
  | { type: 'SET_VIEW_MODE'; mode: 'single' | 'dual-cover' | 'auto' }
  | { type: 'CONTAINER_RESIZED'; width: number; height: number }
  | { type: 'SOURCE_CHANGED'; pageCount: number; initialSpreadIndex?: number };

export function clampSpreadIndex(index: number, spreadCount: number): number {
  if (spreadCount <= 0) return 0;
  return Math.max(0, Math.min(index, spreadCount - 1));
}

export function createInitialState(
  viewMode: 'single' | 'dual-cover' | 'auto' = 'auto',
): FlipbookState {
  const resolvedViewMode = viewMode === 'auto' ? 'single' : viewMode;
  return {
    currentSpreadIndex: 0,
    pageCount: 0,
    spreadCount: 0,
    viewMode,
    resolvedViewMode,
    containerWidth: 0,
    containerHeight: 0,
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
      return {
        ...state,
        pageCount: action.pageCount,
        spreadCount: newSpreadCount,
        currentSpreadIndex: clampSpreadIndex(action.initialSpreadIndex ?? 0, newSpreadCount),
      };
    }
  }
}
