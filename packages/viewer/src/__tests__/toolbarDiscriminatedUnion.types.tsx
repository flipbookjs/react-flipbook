/* eslint-disable @typescript-eslint/no-unused-vars */
// Type-only assertion file for the FlipbookProps discriminated union.
//
// This file deliberately contains NO `it()` / `describe()` / `test()` blocks.
// Vitest will report it as an empty test file. The assertions are enforced
// by `tsc --noEmit` via the `@ts-expect-error` annotations below: each one
// REQUIRES the next line to produce a type error. If the line compiles, the
// `@ts-expect-error` itself errors (TS2578) and the build fails.
//
// `.tsx` extension is required because the cases use JSX. There is no
// `.test-d.ts` convention in vitest for type-only tests; the acceptance
// gate's `tsc --noEmit` is the canonical enforcement.

import * as React from 'react';
import { Flipbook } from '..';

// ----- Valid: built-in toolbar variant -----
const ok1 = <Flipbook url="x" toolbar showPrint />;
const ok2 = <Flipbook url="x" showZoom showDownload />;
const ok3 = <Flipbook url="x" toolbar={false} showThumbnails />;
const ok4 = <Flipbook url="x" toolbar={null} showPrint />;
const ok5 = <Flipbook url="x" toolbar compact title="My Doc" />;
const ok6 = <Flipbook url="x" toolbar enablePageCurl />;

// ----- Valid: custom toolbar variant -----
const ok7 = <Flipbook url="x" toolbar={<div />} />;
const ok8 = <Flipbook url="x" toolbar={{ top: <div />, bottom: <div /> }} />;
const ok9 = <Flipbook url="x" toolbar={{ top: <div /> }} />;
const ok10 = <Flipbook url="x" toolbar={{ bottom: <div /> }} />;
const ok11 = <Flipbook url="x" toolbar={<div />} enablePageCurl />;

// ----- Valid: new 1.0.0 props on both variants -----
const ok12 = <Flipbook url="x" initialInteractionMode="pan" />;
const ok13 = <Flipbook url="x" thumbnailSize="large" />;
const ok14 = <Flipbook url="x" thumbnailSize={400} />;
const ok15 = (
  <Flipbook url="x">
    <span>child mounted inside provider context</span>
  </Flipbook>
);

// ----- Invalid: custom toolbar + show* / compact / title → compile error -----

// @ts-expect-error showPrint is `never` on the custom variant
const bad1 = <Flipbook url="x" toolbar={<div />} showPrint />;

// @ts-expect-error showZoom is `never` on the slot-object form (still custom)
const bad2 = <Flipbook url="x" toolbar={{ top: <div /> }} showZoom />;

// @ts-expect-error compact is `never` on the custom variant
const bad3 = <Flipbook url="x" toolbar={<div />} compact />;

// @ts-expect-error title is `never` on the custom variant
const bad4 = <Flipbook url="x" toolbar={<div />} title="My Doc" />;

// @ts-expect-error showDownload is `never` on the custom variant
const bad5 = <Flipbook url="x" toolbar={<div />} showDownload />;

// @ts-expect-error empty slot object — neither variant of ToolbarSlots matches
//   (the union requires at-least-one of `top` / `bottom`).
const bad6 = <Flipbook url="x" toolbar={{}} />;

// ----- Re-export so TS treats the consts as used; otherwise an aggressive
//   `noUnusedLocals` config could mask the assertion-block compile checks. -----
export type _Fixtures =
  | typeof ok1 | typeof ok2 | typeof ok3 | typeof ok4 | typeof ok5 | typeof ok6
  | typeof ok7 | typeof ok8 | typeof ok9 | typeof ok10 | typeof ok11
  | typeof ok12 | typeof ok13 | typeof ok14 | typeof ok15
  | typeof bad1 | typeof bad2 | typeof bad3 | typeof bad4 | typeof bad5 | typeof bad6;

// `React` is imported for classic-JSX runtime; under automatic-JSX (Vite's
// default) it would be unused. The `void React` keeps the file compilable
// under either tsconfig setting without touching the repo's existing config.
void React;
