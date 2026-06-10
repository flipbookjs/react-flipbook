// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as ToolbarPartsApi from '../toolbar/parts';

// Type-only imports — exercising each as a value annotation below forces
// TypeScript to resolve the imported type. If any type export is removed
// from src/toolbar/parts.ts, this file fails to compile.
import type {
  FocusableElement,
  ToolbarShellContextValue,
  UseToolbarPartReturn,
  ToolbarProps,
} from '../toolbar/parts';

// Expected runtime export surface for the @flipbookjs/react-viewer/toolbar-parts
// sub-path. The list is sorted alphabetically (JS .sort() ascending ASCII —
// uppercase letters sort before lowercase, so `useToolbarPart` lands LAST).
// If a part is added or removed in the future, this constant must change
// too — the test forces a deliberate update rather than silently accepting
// drift. Count = 12 part components + 4 utility exports (ToolbarShell,
// useToolbarPart, ToolbarShellContext, LABELS) + 2 main-entry re-exports
// (Toolbar, ThumbnailPanel — parts.ts re-exports these for consumer
// ergonomics: one-import composition) = 18.
const EXPECTED_RUNTIME_EXPORTS = [
  'DownloadButton',
  'FullScreenButton',
  'LABELS',
  'NextButton',
  'PageReadout',
  'PrevButton',
  'PrintButton',
  'SelectionModeButton',
  'ThemeToggleButton',
  'ThumbnailPanel',
  'ThumbnailsToggleButton',
  'Toolbar',
  'ToolbarShell',
  'ToolbarShellContext',
  'ZoomInButton',
  'ZoomOutButton',
  'ZoomReadout',
  'useToolbarPart',
].sort();

describe('public API exports — toolbar-parts sub-path', () => {
  it('runtime export surface matches the expected allowlist exactly', () => {
    const actual = Object.keys(ToolbarPartsApi).sort();
    expect(actual).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it('LABELS is a string-keyed object with documented entries', () => {
    expect(typeof ToolbarPartsApi.LABELS).toBe('object');
    // Spot-check a representative LABELS entry — full enumeration would
    // duplicate the LABELS source. The allowlist already pins the constant's
    // export; this assertion pins its shape (string-valued).
    expect(typeof ToolbarPartsApi.LABELS.download).toBe('string');
  });

  it('the 12 part components are React.memo + forwardRef objects, the hook is a function', () => {
    // React.memo(forwardRef(fn)) returns an object — `typeof` is 'object'.
    expect(typeof ToolbarPartsApi.PrevButton).toBe('object');
    expect(typeof ToolbarPartsApi.NextButton).toBe('object');
    expect(typeof ToolbarPartsApi.ZoomInButton).toBe('object');
    expect(typeof ToolbarPartsApi.ZoomOutButton).toBe('object');
    expect(typeof ToolbarPartsApi.FullScreenButton).toBe('object');
    expect(typeof ToolbarPartsApi.PrintButton).toBe('object');
    expect(typeof ToolbarPartsApi.DownloadButton).toBe('object');
    expect(typeof ToolbarPartsApi.SelectionModeButton).toBe('object');
    expect(typeof ToolbarPartsApi.ThemeToggleButton).toBe('object');
    expect(typeof ToolbarPartsApi.ThumbnailsToggleButton).toBe('object');
    expect(typeof ToolbarPartsApi.PageReadout).toBe('object');
    expect(typeof ToolbarPartsApi.ZoomReadout).toBe('object');
    // ToolbarShell + Toolbar are also forwardRef'd; ThumbnailPanel is a
    // memoized function component.
    expect(typeof ToolbarPartsApi.ToolbarShell).toBe('object');
    expect(typeof ToolbarPartsApi.Toolbar).toBe('object');
    expect(typeof ToolbarPartsApi.ThumbnailPanel).toBe('object');
    expect(typeof ToolbarPartsApi.useToolbarPart).toBe('function');
  });

  it('ToolbarShellContext is a React Context object', () => {
    expect(typeof ToolbarPartsApi.ToolbarShellContext).toBe('object');
    // React's createContext returns { Provider, Consumer, displayName, ... }.
    // Spot-check Provider exists.
    expect(ToolbarPartsApi.ToolbarShellContext).toHaveProperty('Provider');
  });

  it('exports type-only members usable as value annotations', () => {
    // Each annotation forces TypeScript to resolve the imported type.
    // If any type export is removed from src/toolbar/parts.ts, this test
    // fails to compile. Mirrors the pattern from publicExports.test.ts.

    // ToolbarProps — the public type for <Toolbar> consumers (re-exported
    // here for sub-path-only consumers who want to compose AND type their
    // built-in Toolbar usage from a single import path).
    const toolbarProps: ToolbarProps = { compact: true, title: 'Doc' };
    expect(toolbarProps.compact).toBe(true);

    // FocusableElement — a structural type for the roving-tabindex's focus
    // targets. Construct via document.createElement to satisfy the shape.
    const focusEl: FocusableElement = document.createElement('button');
    void focusEl;

    // ToolbarShellContextValue — the registry context payload. We don't
    // need a runtime value; the annotation alone forces type resolution.
    const _ctxAnnotation: ToolbarShellContextValue | null = null;
    void _ctxAnnotation;

    // UseToolbarPartReturn — what useToolbarPart() returns. Same pattern.
    const _hookReturnAnnotation: UseToolbarPartReturn | null = null;
    void _hookReturnAnnotation;
  });
});
