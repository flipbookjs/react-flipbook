import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { SSR_ACTIONS } from '../hooks/useFlipbook';
import type { FlipbookAction } from '../core/flipbookReducer';
import type { FlipbookHookActions } from '../hooks/useFlipbook';

// Each setup() appends a container div to document.body AND mounts a React
// tree via renderHook (which installs its own container, effects, and an
// unmount handler). The cleanup ORDER matters:
//   1. cleanup() — unmounts the React tree, runs effect cleanups (which
//      remove the keydown listener registered by useKeyboardShortcuts),
//      removes RTL's own container from document.body.
//   2. document.body.innerHTML = '' — sweeps any setup()-created container
//      that's NOT under RTL's control (we appendChild directly).
// Without the explicit cleanup() call, blowing away document.body.innerHTML
// first leaves React's effect cleanups pointing at detached DOM, which can
// trigger spurious "removeEventListener on null" warnings in jsdom AND can
// leak listeners attached to `document` (Decision 4: editable-target check
// uses document.activeElement).
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

// setup() no longer takes a `spreadCount` argument — the new hook signature
// is (containerRef, dispatch, actions). The End-key path is exercised through
// `actions.goToLast` (which is a vi.fn() that takes no arguments), so the
// test asserts the action was called rather than reconstructing the dispatch
// payload. spreadCount lives on the provider's spreadCountRef in production;
// in unit tests it's not visible at this layer.
function setup() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // vi.fn type-parameter form: vitest 4.x takes a single function-signature
  // generic, not the older tuple+return generics. Matches the convention in
  // PageRenderer.test.tsx and usePageCurlGesture.test.tsx.
  const dispatch = vi.fn<(action: FlipbookAction) => void>();
  const actions: FlipbookHookActions = {
    ...SSR_ACTIONS,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitPage: vi.fn(),
    goToLast: vi.fn(),
    toggleFullScreen: vi.fn(() => Promise.resolve()),
    exitFullScreen: vi.fn(() => Promise.resolve()),
  };
  renderHook(() => {
    const ref = useRef<HTMLDivElement | null>(container);
    useKeyboardShortcuts(ref, dispatch, actions);
  });
  return { container, dispatch, actions };
}

function key(container: HTMLElement, init: KeyboardEventInit & { target?: HTMLElement }) {
  const target = init.target ?? container;
  // Dispatch a bubbling keydown from `target`. Per the hook design, the
  // editable-target check reads `event.target` directly (NOT
  // document.activeElement), so we do not need to .focus() the element
  // first — and we MUST NOT, because making focus a precondition would
  // hide bugs where the hook accidentally falls back to activeElement.
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

describe('useKeyboardShortcuts — navigation', () => {
  it('ArrowRight → NEXT_SPREAD', () => {
    const { container, dispatch } = setup();
    key(container, { key: 'ArrowRight' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'NEXT_SPREAD' });
  });

  it('ArrowLeft → PREV_SPREAD', () => {
    const { container, dispatch } = setup();
    key(container, { key: 'ArrowLeft' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'PREV_SPREAD' });
  });

  it('Home → GO_TO_SPREAD index=0', () => {
    const { container, dispatch } = setup();
    key(container, { key: 'Home' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'GO_TO_SPREAD', index: 0 });
  });

  it('End → actions.goToLast (NOT a raw dispatch — End routes through the action layer so the status guard applies)', () => {
    const { container, dispatch, actions } = setup();
    key(container, { key: 'End' });
    expect(actions.goToLast).toHaveBeenCalledTimes(1);
    // End MUST NOT bypass the action. If a regression reintroduces the raw
    // dispatch, this assertion fails because dispatch was called instead.
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'GO_TO_SPREAD' }),
    );
  });
});

describe('useKeyboardShortcuts — Ctrl shortcuts', () => {
  it('Ctrl+= → actions.zoomIn', () => {
    const { container, actions } = setup();
    key(container, { key: '=', ctrlKey: true });
    expect(actions.zoomIn).toHaveBeenCalled();
  });

  it('Ctrl++ → actions.zoomIn', () => {
    const { container, actions } = setup();
    key(container, { key: '+', ctrlKey: true });
    expect(actions.zoomIn).toHaveBeenCalled();
  });

  it('Ctrl+- → actions.zoomOut', () => {
    const { container, actions } = setup();
    key(container, { key: '-', ctrlKey: true });
    expect(actions.zoomOut).toHaveBeenCalled();
  });

  it('Ctrl+0 → actions.fitPage', () => {
    const { container, actions } = setup();
    key(container, { key: '0', ctrlKey: true });
    expect(actions.fitPage).toHaveBeenCalled();
  });

  it('Cmd+= (Mac) → actions.zoomIn', () => {
    const { container, actions } = setup();
    key(container, { key: '=', metaKey: true });
    expect(actions.zoomIn).toHaveBeenCalled();
  });

  it('Ctrl+S is NOT intercepted (passes through to consumer)', () => {
    const { container, actions, dispatch } = setup();
    key(container, { key: 's', ctrlKey: true });
    expect(actions.zoomIn).not.toHaveBeenCalled();
    expect(actions.zoomOut).not.toHaveBeenCalled();
    expect(actions.fitPage).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts — fullscreen', () => {
  it('f → actions.toggleFullScreen', () => {
    const { container, actions } = setup();
    key(container, { key: 'f' });
    expect(actions.toggleFullScreen).toHaveBeenCalled();
  });

  it('Escape → actions.exitFullScreen', () => {
    const { container, actions } = setup();
    key(container, { key: 'Escape' });
    expect(actions.exitFullScreen).toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts — editable-target suppression', () => {
  it('ArrowRight inside <input> is suppressed', () => {
    const { container, dispatch } = setup();
    const input = document.createElement('input');
    container.appendChild(input);
    key(container, { key: 'ArrowRight', target: input });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('f inside <textarea> is suppressed', () => {
    const { container, actions } = setup();
    const ta = document.createElement('textarea');
    container.appendChild(ta);
    key(container, { key: 'f', target: ta });
    expect(actions.toggleFullScreen).not.toHaveBeenCalled();
  });

  it('f inside [contenteditable] is suppressed', () => {
    const { container, actions } = setup();
    const div = document.createElement('div');
    div.contentEditable = 'true';
    // jsdom 29.1.1 doesn't implement `Element.isContentEditable` — the getter
    // returns `undefined` regardless of the `contentEditable` IDL attribute.
    // The hook (correctly, for browsers) reads `target.isContentEditable`; we
    // stub it here so the real production code path runs under test. Test-only
    // workaround, no production change.
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });
    container.appendChild(div);
    key(container, { key: 'f', target: div });
    expect(actions.toggleFullScreen).not.toHaveBeenCalled();
  });

  it('Escape inside <input> is NOT suppressed (universal cancel)', () => {
    const { container, actions } = setup();
    const input = document.createElement('input');
    container.appendChild(input);
    key(container, { key: 'Escape', target: input });
    expect(actions.exitFullScreen).toHaveBeenCalled();
  });

  it('f inside pdfjs <span> (text layer) is NOT suppressed (intentional per Decision 4)', () => {
    const { container, actions } = setup();
    const span = document.createElement('span');
    container.appendChild(span);
    key(container, { key: 'f', target: span });
    expect(actions.toggleFullScreen).toHaveBeenCalled();
  });
});
