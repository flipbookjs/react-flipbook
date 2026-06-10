// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { FlipbookProvider } from '../FlipbookProvider';
import {
  ToolbarShell,
  PrevButton, NextButton,
  ZoomInButton, ZoomOutButton,
  FullScreenButton,
  PrintButton, DownloadButton,
  SelectionModeButton, ThemeToggleButton,
  PageReadout, ZoomReadout,
} from '../toolbar/parts';
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

describe('Toolbar parts — SSR safety', () => {
  it('renderToString of <ToolbarShell> with all 11 parts does not throw', () => {
    const source = makeSource();
    expect(() => renderToString(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <NextButton />
          <PageReadout />
          <ZoomOutButton />
          <ZoomReadout />
          <ZoomInButton />
          <FullScreenButton />
          <PrintButton />
          <DownloadButton />
          <SelectionModeButton />
          <ThemeToggleButton />
        </ToolbarShell>
      </FlipbookProvider>,
    )).not.toThrow();
  });

  it('SSR pass does NOT trigger React useLayoutEffect warnings (H-§1.2)', () => {
    // useToolbarPart uses useIsomorphicLayoutEffect (falls back to useEffect
    // on the server) so React shouldn't log "useLayoutEffect does nothing on
    // the server." Locks in this behavior: a future regression to raw
    // useLayoutEffect would fail this assertion.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = makeSource();
    renderToString(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <NextButton />
          <ZoomInButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    const calls = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(calls).not.toMatch(/useLayoutEffect does nothing on the server/i);
    errorSpy.mockRestore();
  });

  it('SSR output includes role="toolbar" and the aria-label', () => {
    const source = makeSource();
    const html = renderToString(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Document viewer controls"');
  });

  it('SSR output marks buttons aria-disabled during loading (NOT native HTML disabled)', () => {
    const source = makeSource();
    const html = renderToString(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    // SSR pass returns SSR_HOOK (status: 'loading'); PrevButton's selector
    // returns isDisabled=true. The library uses aria-disabled (NOT native
    // HTML disabled) so the button stays focusable — see Section 4.2.
    expect(html).toContain('aria-disabled="true"');
    // Stronger: native HTML `disabled` (alone, no `aria-` prefix) MUST NOT
    // appear. The regex matches `disabled` as an attribute (preceded by
    // whitespace and followed by `=` or `>` or quote) but NOT preceded by `-`
    // (which would catch aria-disabled). A simple substring check fails
    // because aria-disabled contains "disabled" — use a regex.
    expect(html).not.toMatch(/(?<!-)disabled(=|\s|>)/);
  });

  it('SSR output renders ALL parts with tabindex="-1" (no active part until hydration)', () => {
    // Locks in the documented Known Limitation: during SSR, `activeId` is
    // null in the shell's initial state. The hook computes
    // `tabIndex = shell.activeId === id ? 0 : -1`, so all parts render with
    // tabindex="-1". The HTML toolbar has no Tab landing target.
    //
    // After hydration: useLayoutEffect fires synchronously post-hydration,
    // the first part's registerPart runs, setActiveId elects the first part,
    // re-render bumps its tabindex to 0. Window between hydration and that
    // re-render is microseconds — invisible to humans, but server-rendered
    // HTML (before JS load) has NO focusable toolbar target. Documented in
    // Section 4.2 Known Limitations.
    const source = makeSource();
    const html = renderToString(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <NextButton />
          <ZoomInButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    // Scope the assertions to within the toolbar div so unrelated elsewhere-
    // in-SSR tabindex values (e.g., FlipbookProvider's loading-container
    // tabindex="0" for screen-reader focus) don't false-positive these
    // toolbar-specific invariants.
    const toolbarHtml = html.match(/<div role="toolbar"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(toolbarHtml).toBeTruthy();
    // Every button in the toolbar SSR HTML should have tabindex="-1".
    const tabIndexMatches = toolbarHtml.match(/tabindex="(-?\d+)"/g) ?? [];
    expect(tabIndexMatches.length).toBeGreaterThanOrEqual(3);
    for (const match of tabIndexMatches) {
      expect(match).toBe('tabindex="-1"');
    }
    // Stronger assertion: ZERO `tabindex="0"` anywhere in the toolbar SSR
    // output. Catches the regression of "someone added a part that bypasses
    // useToolbarPart and hardcodes tabindex=0" — which would silently break
    // the documented SSR contract (no Tab landing target until hydration).
    expect(toolbarHtml).not.toContain('tabindex="0"');
  });

  it('SSR output includes em-dash placeholders for readouts during loading', () => {
    const source = makeSource();
    const html = renderToString(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PageReadout />
          <ZoomReadout />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    // Both readouts show '—' during loading because SSR_HOOK's status is
    // 'loading'. The HTML-encoded em-dash is —.
    expect(html).toContain('—');
  });

  it('SSR output uses the LABELS English strings', () => {
    const source = makeSource();
    const html = renderToString(
      <FlipbookProvider source={source}>
        <ToolbarShell>
          <PrevButton />
          <NextButton />
        </ToolbarShell>
      </FlipbookProvider>,
    );
    expect(html).toContain('Previous page');
    expect(html).toContain('Next page');
  });
});
