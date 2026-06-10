import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { FlipbookProvider } from '../FlipbookProvider';
import { useFlipbookActions, useFlipbookSelector } from '../hooks/useFlipbook';
import { ToolbarShell } from '../toolbar/ToolbarShell';
import { PrevButton } from '../toolbar/buttons/PrevButton';
import { NextButton } from '../toolbar/buttons/NextButton';
import { ZoomInButton } from '../toolbar/buttons/ZoomInButton';
import { ZoomOutButton } from '../toolbar/buttons/ZoomOutButton';
import { FullScreenButton } from '../toolbar/buttons/FullScreenButton';
import { PrintButton } from '../toolbar/buttons/PrintButton';
import { DownloadButton } from '../toolbar/buttons/DownloadButton';
import { SelectionModeButton } from '../toolbar/buttons/SelectionModeButton';
import { ThemeToggleButton } from '../toolbar/buttons/ThemeToggleButton';
import { PageReadout } from '../toolbar/readouts/PageReadout';
import { ZoomReadout } from '../toolbar/readouts/ZoomReadout';
import type { FlipbookHookActions } from '../hooks/useFlipbook';
import type { PageSource } from '../types/PageSource';

function makeSource(pageCount = 4): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => pageCount,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

/**
 * Per-part render counter via `<Profiler>`. The Profiler's `onRender` fires
 * each time its DESCENDANTS render (including the target part itself).
 * Wrapping each part in its own Profiler gives us per-part isolation.
 *
 * Why Profiler and not a Render-counter HOC: HOCs add an extra component
 * layer that re-renders on every parent re-render, polluting the count.
 * Profiler is a transparent wrapper (zero render cost for its own boundary)
 * AND captures the actual reconciler-level render decisions.
 *
 * Profiler's onRender includes a `phase` arg ('mount' | 'update' | 'nested-
 * update'). We only count 'update' phases for the perf-claim assertion;
 * mounts are expected once per initial render.
 */
function makeCounter() {
  const counts = { mount: 0, update: 0 };
  const onRender: ProfilerOnRenderCallback = (_id, phase) => {
    if (phase === 'mount') counts.mount++;
    else if (phase === 'update' || phase === 'nested-update') counts.update++;
  };
  return { counts, onRender };
}

describe('Parts rendering — narrow-selector + memo perf claim', () => {
  it('NEXT_SPREAD dispatch wakes ONLY nav-related parts (prev/next/pageReadout), not zoom/theme/etc.', async () => {
    // 2-page source so that the SINGLE next() call drives both PrevButton's
    // and NextButton's `disabled` selector to flip — PrevButton from
    // disabled=true (at spread 0) to false; NextButton from disabled=false
    // (at spread 0 of 2) to true (at spread 1 = last spread). With a 4-page
    // source, NextButton's disabled stays false across spread 0→1, so its
    // selector return doesn't change and the memoized button correctly does
    // NOT re-render — which would have made the original assertion
    // `expect(next.counts.update).toBeGreaterThan(baseline.next)` false
    // (review finding MEDIUM 3).
    const source = makeSource(2);
    let capturedActions: FlipbookHookActions | null = null;

    const prev = makeCounter();
    const next = makeCounter();
    const page = makeCounter();
    const zoomIn = makeCounter();
    const zoomOut = makeCounter();
    const zoomReadout = makeCounter();
    const fullScreen = makeCounter();
    const print = makeCounter();
    const download = makeCounter();
    const selection = makeCounter();
    const theme = makeCounter();

    // Status probe — reads the live snapshot status so we can wait for it
    // to become 'ready' BEFORE snapshotting baseline counts. Without this,
    // post-mount CONTAINER_RESIZED + SOURCE_CHANGED dispatches happen AFTER
    // we record the baseline, polluting it and producing false "should not
    // have re-rendered" failures on unrelated parts.
    const statusSeen: string[] = [];
    function Dispatcher() {
      capturedActions = useFlipbookActions();
      const status = useFlipbookSelector((s) => s.status);
      statusSeen.push(status);
      return null;
    }

    render(
      <FlipbookProvider source={source}>
        <Dispatcher />
        <ToolbarShell>
          <Profiler id="prev" onRender={prev.onRender}><PrevButton /></Profiler>
          <Profiler id="next" onRender={next.onRender}><NextButton /></Profiler>
          <Profiler id="page" onRender={page.onRender}><PageReadout /></Profiler>
          <Profiler id="zoomOut" onRender={zoomOut.onRender}><ZoomOutButton /></Profiler>
          <Profiler id="zoomReadout" onRender={zoomReadout.onRender}><ZoomReadout /></Profiler>
          <Profiler id="zoomIn" onRender={zoomIn.onRender}><ZoomInButton /></Profiler>
          <Profiler id="fullScreen" onRender={fullScreen.onRender}><FullScreenButton /></Profiler>
          <Profiler id="print" onRender={print.onRender}><PrintButton /></Profiler>
          <Profiler id="download" onRender={download.onRender}><DownloadButton /></Profiler>
          <Profiler id="selection" onRender={selection.onRender}><SelectionModeButton /></Profiler>
          <Profiler id="theme" onRender={theme.onRender}><ThemeToggleButton /></Profiler>
        </ToolbarShell>
      </FlipbookProvider>,
    );

    // Wait for the live snapshot to transition to 'ready' — covers both the
    // source.init() resolution AND the SOURCE_CHANGED dispatch that follows.
    // Use a state-convergence wait rather than a setTimeout flush (T11).
    // Explicit { timeout: 5000 } on the critical waits — under a loaded CI
    // runner the React render queue + dispatch chain can exceed vitest's
    // 1000ms default in pathological cases (M-§6.1). 5s is a defensive
    // ceiling that doesn't slow happy-path tests but rescues flaky CI.
    await vi.waitFor(() => expect(capturedActions).not.toBeNull(), { timeout: 5000 });
    await vi.waitFor(() => expect(statusSeen).toContain('ready'), { timeout: 5000 });
    // Belt-and-suspenders: also confirm PageReadout rendered the ready-state
    // text by snapshotting once (testid stable from the part itself).
    await vi.waitFor(() => {
      const node = document.querySelector('[data-testid="fbjs-page-readout"]');
      expect(node?.textContent).toMatch(/Page \d+ of \d+/);
    }, { timeout: 5000 });

    // Snapshot baseline AFTER initial mount + source-ready dispatches.
    const baseline = {
      prev: prev.counts.update,
      next: next.counts.update,
      page: page.counts.update,
      zoomIn: zoomIn.counts.update,
      zoomOut: zoomOut.counts.update,
      zoomReadout: zoomReadout.counts.update,
      fullScreen: fullScreen.counts.update,
      print: print.counts.update,
      download: download.counts.update,
      selection: selection.counts.update,
      theme: theme.counts.update,
    };

    // Dispatch NEXT_SPREAD: state.spreadIndex 0→1, state.pageNumber 1→2.
    act(() => { capturedActions!.next(); });
    await vi.waitFor(() => expect(page.counts.update).toBeGreaterThan(baseline.page), { timeout: 5000 });

    // Nav-related parts SHOULD re-render:
    expect(prev.counts.update).toBeGreaterThan(baseline.prev);          // disabled flips true → false (was at first spread)
    expect(next.counts.update).toBeGreaterThan(baseline.next);          // disabled flips false → true (now at last spread)
    expect(page.counts.update).toBeGreaterThan(baseline.page);          // pageNumber changes

    // Unrelated parts MUST NOT have re-rendered:
    expect(zoomIn.counts.update).toBe(baseline.zoomIn);
    expect(zoomOut.counts.update).toBe(baseline.zoomOut);
    expect(zoomReadout.counts.update).toBe(baseline.zoomReadout);
    expect(fullScreen.counts.update).toBe(baseline.fullScreen);
    expect(print.counts.update).toBe(baseline.print);
    expect(download.counts.update).toBe(baseline.download);
    expect(selection.counts.update).toBe(baseline.selection);
    expect(theme.counts.update).toBe(baseline.theme);
  });

  it('source rotation re-renders ALL parts (snapshot rotates fully + actions identity rotates)', async () => {
    const sourceA = makeSource(4);
    const sourceB = makeSource(6);

    const prev = makeCounter();
    const zoom = makeCounter();
    const theme = makeCounter();

    // Same status-probe pattern as the first test — wait for the source to
    // reach 'ready' before snapshotting the baseline, so post-mount
    // CONTAINER_RESIZED + SOURCE_CHANGED dispatches don't pollute it.
    const statusSeenA: string[] = [];
    function StatusProbe({ seen }: { seen: string[] }) {
      const status = useFlipbookSelector((s) => s.status);
      seen.push(status);
      return null;
    }

    let currentSource: PageSource = sourceA;
    function App({ seen }: { seen: string[] }) {
      return (
        <FlipbookProvider source={currentSource}>
          <StatusProbe seen={seen} />
          <ToolbarShell>
            <Profiler id="prev" onRender={prev.onRender}><PrevButton /></Profiler>
            <Profiler id="zoom" onRender={zoom.onRender}><ZoomInButton /></Profiler>
            <Profiler id="theme" onRender={theme.onRender}><ThemeToggleButton /></Profiler>
          </ToolbarShell>
        </FlipbookProvider>
      );
    }
    const { rerender } = render(<App seen={statusSeenA} />);
    await vi.waitFor(() => expect(prev.counts.mount).toBeGreaterThan(0), { timeout: 5000 });
    await vi.waitFor(() => expect(statusSeenA).toContain('ready'), { timeout: 5000 });

    const baseline = { prev: prev.counts.update, zoom: zoom.counts.update, theme: theme.counts.update };

    // Rotate to sourceB. The provider transitions back to 'loading' (stale-
    // source guard) and then to 'ready' once sourceB.init() resolves. Wait
    // for the SECOND 'ready' arrival before asserting re-render counts.
    const statusSeenB: string[] = [];
    currentSource = sourceB;
    rerender(<App seen={statusSeenB} />);
    await vi.waitFor(() => expect(statusSeenB).toContain('ready'), { timeout: 5000 });
    await vi.waitFor(() => expect(prev.counts.update).toBeGreaterThan(baseline.prev), { timeout: 5000 });

    // All three parts should re-render on source rotation (snapshot rotates).
    expect(prev.counts.update).toBeGreaterThan(baseline.prev);
    expect(zoom.counts.update).toBeGreaterThan(baseline.zoom);
    expect(theme.counts.update).toBeGreaterThan(baseline.theme);
  });
});
