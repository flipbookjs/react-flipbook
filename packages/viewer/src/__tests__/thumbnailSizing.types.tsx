/* eslint-disable @typescript-eslint/no-unused-vars */
// Type-only assertion file for the 2.0 thumbnail-sizing discriminated union.
//
// This file deliberately contains NO `it()` / `describe()` / `test()` blocks.
// Vitest will report it as an empty test file. The assertions are enforced
// by `tsc --noEmit` via the `@ts-expect-error` annotations below: each one
// REQUIRES the next line to produce a type error. If the line compiles, the
// `@ts-expect-error` itself errors (TS2578) and the build fails.
//
// `.tsx` extension is required because the cases use JSX. The repo's existing
// `toolbarDiscriminatedUnion.types.tsx` follows the same convention.
//
// Cross-product coverage (per the architecture-review checklist): both
// toolbar variants (built-in / custom) × both sizing variants (density /
// width) × omit-both + both-supplied negative cases × the composable
// `<ThumbnailPanel>` direct surface.

import * as React from 'react';
import { Flipbook, ThumbnailPanel } from '..';

// ----- Built-in toolbar variant × sizing -----
const ok1 = <Flipbook url="x" thumbnailDensity="compact" />;
const ok2 = <Flipbook url="x" thumbnailDensity="comfortable" />;
const ok3 = <Flipbook url="x" thumbnailDensity="spacious" />;
const ok4 = <Flipbook url="x" thumbnailWidth={500} />;
const ok5 = <Flipbook url="x" />;   // omit both → default density 'comfortable'

// ----- Custom toolbar variant × sizing -----
const ok6  = <Flipbook url="x" toolbar={<div />} thumbnailDensity="compact" />;
const ok7  = <Flipbook url="x" toolbar={<div />} thumbnailWidth={500} />;
const ok8  = <Flipbook url="x" toolbar={<div />} />;
const ok9  = <Flipbook url="x" toolbar={{ top: <div /> }} thumbnailDensity="spacious" />;
const ok10 = <Flipbook url="x" toolbar={{ bottom: <div /> }} thumbnailWidth={720} />;

// ----- Composable <ThumbnailPanel> direct surface -----
const ok11 = <ThumbnailPanel density="comfortable" />;
const ok12 = <ThumbnailPanel width={400} />;
const ok13 = <ThumbnailPanel />;

// ----- Invalid: both density and width supplied — built-in toolbar -----

// @ts-expect-error supplying both is a TypeScript error (discriminated union)
const bad1 = <Flipbook url="x" thumbnailDensity="compact" thumbnailWidth={500} />;

// ----- Invalid: both density and width supplied — custom toolbar -----

// @ts-expect-error supplying both is a TypeScript error (discriminated union)
const bad2 = <Flipbook url="x" toolbar={<div />} thumbnailDensity="compact" thumbnailWidth={500} />;

// ----- Invalid: <ThumbnailPanel> direct surface, both density and width -----

// @ts-expect-error supplying both is a TypeScript error (discriminated union)
const bad3 = <ThumbnailPanel density="comfortable" width={500} />;

// ----- Invalid: unknown density string at type level -----

// @ts-expect-error 'tiny' is not a member of the density token union
const bad4 = <Flipbook url="x" thumbnailDensity="tiny" />;

// ----- Re-export to keep all fixtures "used" — guards against
//   `noUnusedLocals` eliminating the assertion block. -----
export type _Fixtures =
  | typeof ok1  | typeof ok2  | typeof ok3  | typeof ok4  | typeof ok5
  | typeof ok6  | typeof ok7  | typeof ok8  | typeof ok9  | typeof ok10
  | typeof ok11 | typeof ok12 | typeof ok13
  | typeof bad1 | typeof bad2 | typeof bad3 | typeof bad4;

// `React` is imported for classic-JSX runtime; under automatic-JSX (Vite's
// default) it would be unused. The `void React` keeps the file compilable
// under either tsconfig setting without touching the repo's existing config.
void React;
