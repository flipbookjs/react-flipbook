// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { FlipbookProvider } from '../FlipbookProvider';
import {
  useFlipbook,
  useFlipbookSelector,
  useFlipbookActions,
  SSR_HOOK,
  SSR_STATE,
  SSR_ACTIONS,
  SSR_HELPERS,
} from '../hooks/useFlipbook';
import type { PageSource } from '../types/PageSource';

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(),
    dispose: () => {},
  };
}

describe('useFlipbook* — SSR safety', () => {
  it('renderToString does not throw (no top-level window/document access)', () => {
    const source = makeSource();
    function Probe() {
      const fb = useFlipbook();
      return <div>{fb.state.totalPages}</div>;
    }
    expect(() => renderToString(
      <FlipbookProvider source={source}><Probe /></FlipbookProvider>,
    )).not.toThrow();
  });

  it('useFlipbook returns SSR_HOOK identity during server render', () => {
    const source = makeSource();
    let captured: ReturnType<typeof useFlipbook> | null = null;
    function Probe() {
      captured = useFlipbook();
      return null;
    }
    renderToString(
      <FlipbookProvider source={source}><Probe /></FlipbookProvider>,
    );
    // On the server, getServerSnapshot returns SSR_SNAPSHOT (the frozen
    // module-level constant). useFlipbook detects this via identity equality
    // and returns the matching SSR_HOOK.
    expect(captured).toBe(SSR_HOOK);
    expect(captured!.status).toBe('loading');
    expect(captured!.error).toBeNull();
    expect(captured!.source).toBeNull();
    expect(captured!.state).toBe(SSR_STATE);
    expect(captured!.actions).toBe(SSR_ACTIONS);
    expect(captured!.helpers).toBe(SSR_HELPERS);
  });

  it('useFlipbookSelector returns the selector applied to SSR_SNAPSHOT during server render', () => {
    const source = makeSource();
    let totalPages: number | null = null;
    function Probe() {
      totalPages = useFlipbookSelector((s) => s.state.totalPages);
      return null;
    }
    renderToString(
      <FlipbookProvider source={source}><Probe /></FlipbookProvider>,
    );
    expect(totalPages).toBe(0);   // SSR_STATE.totalPages
  });

  it('useFlipbookActions returns SSR_ACTIONS during server render', () => {
    const source = makeSource();
    let actions: ReturnType<typeof useFlipbookActions> | null = null;
    function Probe() {
      actions = useFlipbookActions();
      return null;
    }
    renderToString(
      <FlipbookProvider source={source}><Probe /></FlipbookProvider>,
    );
    expect(actions).toBe(SSR_ACTIONS);
  });

  // NOTE: there is no separate test for `helpers.canFullScreen === false` on
  // the server — useFlipbook() in SSR returns SSR_HOOK whose helpers IS
  // SSR_HELPERS (hardcoded `canFullScreen: false`), so such a test would only
  // verify a module-level constant. The runtime `typeof document !== 'undefined'`
  // check in the provider's `canFullScreen` useMemo is exercised by the SSR
  // pass (it computes `false` because `document` is undefined in node), but its
  // result never reaches `useFlipbook` consumers during SSR — `getServerSnapshot`
  // returns SSR_SNAPSHOT, short-circuiting the runtime computation. Both paths
  // produce `canFullScreen: false` server-side; that property is covered by the
  // `useFlipbook returns SSR_HOOK identity` test above (which asserts
  // `captured!.helpers === SSR_HELPERS`).
});
