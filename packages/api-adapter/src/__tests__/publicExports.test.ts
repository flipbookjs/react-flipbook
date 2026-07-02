import { describe, it, expect } from 'vitest';
import * as AdapterApi from '../index';
import {
  PreRenderedPageSource,
  createFlipbookSource,
} from '../index';

// Type imports — if any is missing from the public surface, tsc fails.
// The presence of each name IN THE IMPORT BLOCK is the assertion. The
// spot-check test at the bottom of this file references a subset (the
// 1.5.0 additions + PreRenderedPageSourceOptions as a pre-existing
// representative) as a belt-and-suspenders runtime check; adding a
// runtime reference for every type would duplicate work already done
// in per-feature test files (searchTerm.test.ts, getReadingOrder.test.ts,
// getAccessibility.test.ts, etc.) — see plan §9.2 "On which types get
// spot-checked" note.
//
// `no-unused-vars` disable is deliberate here: the linter treats the
// unreferenced type imports as dead code, but the type-import block IS
// the test. Removing the disable would force one of two undesirable
// alternatives: (a) add runtime references for all ~20 types (bloat), or
// (b) alias each unused import with `_` prefix (obscures the source
// name and breaks the intent of "verify each name is exported").
/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
  PreRenderedPageSourceOptions,
  Manifest,
  SearchOptions,
  SearchHit,
  SearchIndexEnvelope,
  InvertedIndex,
  SortedPositionalIndex,
  ReadingOrder,
  ReadingOrderBlock,
  ReadingOrderBlockKind,
  ReadingOrderSource,
  ReadingOrderOptions,
  PageAccessibility,
  AccessibilityReport,
  AccessibilityRegion,
  AccessibilityHeading,
  AccessibilityAltText,
  AccessibilityOptions,
  AccessibilitySource,
  RemediationStatus,
  // 1.5.0 additions
  FlipbookDocument,
  FlipbookDocumentStatus,
  CreateFlipbookSourceOptions,
} from '../index';
/* eslint-enable @typescript-eslint/no-unused-vars */

// Expected RUNTIME exports — authoritative allowlist. If index.ts adds or
// removes a runtime export, this constant MUST be updated. That's the
// point: the test forces a deliberate update rather than silently
// accepting drift.
const EXPECTED_RUNTIME_EXPORTS = [
  'PreRenderedPageSource',
  'createFlipbookSource',
].sort();

describe('adapter public API exports', () => {
  it('runtime export surface matches the expected allowlist exactly', () => {
    const actual = Object.keys(AdapterApi).sort();
    expect(actual).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it('createFlipbookSource is a callable function', () => {
    expect(typeof createFlipbookSource).toBe('function');
  });

  it('PreRenderedPageSource is a class (constructor)', () => {
    expect(typeof PreRenderedPageSource).toBe('function');
    // Class constructors are functions in JavaScript; the practical way
    // to verify "class-like" is that `new PreRenderedPageSource(...)`
    // doesn't throw for well-formed input. We don't instantiate here
    // (that would trigger fetch + init); the type check alone is enough
    // to prove the runtime binding exists.
  });

  // Consumer-facing type spot-checks. These force the type imports at
  // the top to actually be referenced (otherwise tsc's unused-import
  // check would strip them). If any type is removed from the surface,
  // the surrounding `import type` block fails to compile.
  it('type imports resolve at compile time (spot check)', () => {
    const _doc: FlipbookDocument = {
      id: 'x', teamId: 'x', title: 'x',
      sourcePdfUrl: 'https://example.com/x.pdf',
      status: 'uploaded',
    };
    const _status: FlipbookDocumentStatus = 'ready';
    const _opts: CreateFlipbookSourceOptions = { credentials: 'include' };
    const _psOpts: PreRenderedPageSourceOptions = { bundleUrl: 'https://example.com/bundle' };
    // Reference each to defeat unused-var lint.
    expect([_doc, _status, _opts, _psOpts]).toHaveLength(4);
  });
});
