// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as PublicApi from '../index';
import {
  Flipbook,
  PdfjsSource,
  SpecialZoomLevel,
  configurePdfWorker,
} from '../index';

// Type imports — if any of these are missing from the public surface,
// TypeScript build fails. The runtime tests below also use them as
// value annotations, which both compiles AND exercises the import.
import type {
  DefaultScale,
  FlipbookProps,
  PageSource,
  TextItem,
  LinkAnnotation,
  OutlineItem,
  PdfjsSourceOptions,
  Spread,
  ToolbarProps,
} from '../index';

// Expected runtime exports — authoritative list. If something is added or
// removed from src/index.ts, this constant must change too. That's the point:
// the test forces a deliberate update rather than silently accepting drift.
const EXPECTED_RUNTIME_EXPORTS = [
  'Flipbook',
  'PdfjsSource',
  'SpecialZoomLevel',
  'ThumbnailPanel',
  'Toolbar',
  'configurePdfWorker',
].sort();

describe('public API exports', () => {
  it('runtime export surface matches the expected allowlist exactly', () => {
    // Star import captures every named runtime export. Default exports would
    // appear as the 'default' key (we have none). Any unintended additions
    // or removals fail this assertion.
    const actual = Object.keys(PublicApi).sort();
    expect(actual).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it('exports the documented runtime values', () => {
    expect(typeof Flipbook).toBe('function');
    expect(typeof PdfjsSource).toBe('function');
    expect(typeof configurePdfWorker).toBe('function');
    // SpecialZoomLevel is a string enum — at runtime it's an object with the
    // three documented members.
    expect(typeof SpecialZoomLevel).toBe('object');
    expect(SpecialZoomLevel.PageFit).toBe('fit-page');
    expect(SpecialZoomLevel.PageWidth).toBe('fit-width');
    expect(SpecialZoomLevel.ActualSize).toBe('ActualSize');
  });

  it('exports types usable as value annotations', () => {
    // Each annotation forces TypeScript to resolve the imported type.
    // If any type export is removed from src/index.ts, this file fails
    // to compile.
    const spread: Spread = { left: null, right: 0 };
    const text: TextItem = { text: 'x', x: 0, y: 0, width: 1, height: 1 };
    const link: LinkAnnotation = { rect: [0, 0, 1, 1] };
    const outline: OutlineItem = { title: 't', pageIndex: 0 };
    const opts: PdfjsSourceOptions = {};
    const props: FlipbookProps = {};
    const propsWithCurl: FlipbookProps = { enablePageCurl: true };
    // DefaultScale type — accepts strings, numbers, and SpecialZoomLevel enum members.
    const scaleString: DefaultScale = 'fit-page';
    const scaleNumber: DefaultScale = 1.5;
    const scaleEnum: DefaultScale = SpecialZoomLevel.PageFit;
    // Explicit 'ActualSize' sentinel coverage — without this line, removing
    // 'ActualSize' from the DefaultScale union would not be caught by any
    // existing assertion (scaleEnum uses PageFit; PageWidth/PageFit string
    // values don't touch the 'ActualSize' branch of the union).
    const scaleActual: DefaultScale = 'ActualSize';
    // FlipbookProps.defaultScale accepts the same union (CMS-migration ergonomic check
    // from architectural plan Decision 5).
    const propsWithScale: FlipbookProps = { defaultScale: SpecialZoomLevel.PageWidth };
    // ToolbarProps — public type from Step 6C. Omits the internal `position`
    // field; consumers writing a typed prop object cannot include it.
    const toolbarProps: ToolbarProps = { compact: true, title: 'Doc' };

    expect(spread.right).toBe(0);
    expect(spread.left).toBeNull();
    expect(text.text).toBe('x');
    expect(link.rect).toHaveLength(4);
    expect(outline.title).toBe('t');
    expect(opts).toEqual({});
    expect(props).toEqual({});
    expect(propsWithCurl.enablePageCurl).toBe(true);
    expect(scaleString).toBe('fit-page');
    expect(scaleNumber).toBe(1.5);
    expect(scaleEnum).toBe('fit-page');
    expect(scaleActual).toBe('ActualSize');
    expect(propsWithScale.defaultScale).toBe('fit-width');
    expect(toolbarProps.compact).toBe(true);
    expect(toolbarProps.title).toBe('Doc');
  });

  it('PageSource is a structural interface', () => {
    // PageSource is a TypeScript interface — there's no runtime value
    // to import. We test it by satisfying its shape via a mock object.
    const source: PageSource = {
      init: () => Promise.resolve(),
      getPageCount: () => 0,
      getPageSize: () => ({ width: 0, height: 0 }),
      renderPage: () => Promise.resolve(document.createElement('canvas')),
      dispose: () => {},
    };
    expect(typeof source.init).toBe('function');
  });
});
