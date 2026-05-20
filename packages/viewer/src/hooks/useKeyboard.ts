import { useEffect, type RefObject } from 'react';
import type { FlipbookAction } from '../core/flipbookReducer';

export function useKeyboard(
  containerRef: RefObject<HTMLDivElement | null>,
  dispatch: (action: FlipbookAction) => void,
  spreadCount: number,
): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          dispatch({ type: 'NEXT_SPREAD' });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          dispatch({ type: 'PREV_SPREAD' });
          break;
        case 'Home':
          e.preventDefault();
          dispatch({ type: 'GO_TO_SPREAD', index: 0 });
          break;
        case 'End':
          e.preventDefault();
          dispatch({ type: 'GO_TO_SPREAD', index: spreadCount - 1 });
          break;
      }
    };

    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [containerRef, dispatch, spreadCount]);
}
