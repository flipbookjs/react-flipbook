// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as Parts from '../toolbar/parts';
import {
  ToolbarShell,
  useToolbarPart,
  ToolbarShellContext,
  PrevButton, NextButton,
  ZoomInButton, ZoomOutButton,
  FullScreenButton,
  PrintButton, DownloadButton,
  SelectionModeButton, ThemeToggleButton,
  PageReadout,
  ToolbarMenu, ZoomMenu,
  LABELS,
} from '../toolbar/parts';

// Type imports — if any of these are missing from the sub-path surface,
// TypeScript build fails.
import type {
  ToolbarShellContextValue,
  UseToolbarPartReturn,
} from '../toolbar/parts';

// Authoritative allowlist. If parts.ts adds or removes a named export, this
// constant must change too — same forcing-deliberate-update pattern as the
// main entry's publicExports.test.ts.
const EXPECTED_RUNTIME_EXPORTS = [
  'ToolbarShell',
  'useToolbarPart',
  'ToolbarShellContext',
  'PrevButton',
  'NextButton',
  'ZoomInButton',
  'ZoomOutButton',
  'FullScreenButton',
  'PrintButton',
  'DownloadButton',
  'SelectionModeButton',
  'ThemeToggleButton',
  'ThumbnailsToggleButton',
  'PageReadout',
  'ToolbarMenu',
  'ZoomMenu',
  'LABELS',
  'Toolbar',
  'ThumbnailPanel',
].sort();

describe('toolbar-parts sub-path public API', () => {
  it('runtime export surface matches the expected allowlist exactly', () => {
    const actual = Object.keys(Parts).sort();
    expect(actual).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it('exports the documented runtime values', () => {
    // Components and the hook are functions; the context is an object.
    expect(typeof ToolbarShell).toBe('object');   // forwardRef returns a $$typeof object, not a plain function
    expect(typeof useToolbarPart).toBe('function');
    expect(typeof ToolbarShellContext).toBe('object');
    // The component exports — each is either a plain function (memo'd) or
    // a $$typeof object (forwardRef).
    expect(typeof PrevButton).toBe('object');   // React.memo wraps to a $$typeof
    expect(typeof NextButton).toBe('object');
    expect(typeof ZoomInButton).toBe('object');
    expect(typeof ZoomOutButton).toBe('object');
    expect(typeof FullScreenButton).toBe('object');
    expect(typeof PrintButton).toBe('object');
    expect(typeof DownloadButton).toBe('object');
    expect(typeof SelectionModeButton).toBe('object');
    expect(typeof ThemeToggleButton).toBe('object');
    expect(typeof PageReadout).toBe('object');
    expect(typeof ToolbarMenu).toBe('object');   // memo + forwardRef wraps to $$typeof
    expect(typeof ZoomMenu).toBe('object');
  });

  it('exports LABELS with the documented English strings', () => {
    expect(LABELS.toolbarLabel).toBe('Document viewer controls');
    expect(LABELS.prevPage).toBe('Previous page');
    expect(LABELS.nextPage).toBe('Next page');
    expect(typeof LABELS.pageReadout).toBe('function');
    expect(LABELS.pageReadout(3, 10)).toBe('Page 3 of 10');
    expect(typeof LABELS.zoomMenuTriggerLabel).toBe('function');
    expect(LABELS.zoomMenuTriggerLabel(125)).toBe('Zoom menu, current level 125%');
    expect(LABELS.zoomMenuTriggerLabel(null)).toBe('Zoom menu, level not yet available');
    expect(LABELS.zoomMenuPopoverLabel).toBe('Zoom levels');
  });

  it('exports types usable as value annotations', () => {
    // Each annotation forces TypeScript to resolve the imported type.
    const value: ToolbarShellContextValue = {
      registerPart: () => () => {},
      activeId: null,
      setActiveId: () => {},
      focusFirst: () => {},
      focusLast: () => {},
      focusNext: () => {},
      focusPrevious: () => {},
    };
    expect(value.activeId).toBeNull();
    const partReturn: UseToolbarPartReturn = {
      ref: { current: null },
      tabIndex: 0,
      onFocus: () => {},
      onKeyDown: () => {},
    };
    expect(partReturn.tabIndex).toBe(0);
  });
});

describe('toolbar-parts sub-path — main entry is NOT polluted', () => {
  // Sanity check: importing from the main entry does NOT yield the toolbar
  // parts. If a future refactor accidentally adds the parts to src/index.ts,
  // this test catches the leak.
  it('main entry does not export PrevButton/NextButton/etc.', async () => {
    const main = await import('../index');
    const keys = Object.keys(main);
    expect(keys).not.toContain('PrevButton');
    expect(keys).not.toContain('NextButton');
    expect(keys).not.toContain('ToolbarShell');
    expect(keys).not.toContain('useToolbarPart');
    expect(keys).not.toContain('ToolbarMenu');
    expect(keys).not.toContain('ZoomMenu');
  });
});
