/**
 * Dev-only logging helper. Gated behind `process.env.NODE_ENV !== 'production'`
 * so that, under any production bundler that replaces `process.env.NODE_ENV`
 * with the literal string `'production'` (Vite, Webpack DefinePlugin, esbuild's
 * `--define`, Rollup with `@rollup/plugin-replace`, the default Next.js
 * production build), the dead-code-elimination pass strips the body —
 * including the string argument — from the production bundle.
 *
 * Used by:
 *   - FlipbookProvider.tsx (goToPage NotReady/Invalid; goToLast NotReady)
 *   - useKeyboardShortcuts.ts (fullscreen rejection logs — Rule 1: fail loud)
 *
 * Don't use this for messages a CONSUMER of the library should see —
 * those should be thrown errors or props-validation patterns. This is
 * a developer-facing tracelog for events that should NEVER happen in
 * correctly-wired code.
 *
 * Note: this repo's `eslint.config.js` does NOT enable the `no-console`
 * rule, so the `console.warn` below is allowed without a directive. If a
 * future commit adds `no-console`, add `/* eslint-disable no-console *​/`
 * around the function body at that point.
 */

export function devWarn(...args: unknown[]): void {
  // `typeof process !== 'undefined'` guard handles the rare no-bundler case
  // (consumer importing the viewer's ESM directly via CDN / import-map).
  // Under any production bundler (Vite/Webpack/esbuild/Rollup/Next), the
  // `process.env.NODE_ENV` access is REPLACED with the literal string at
  // build time (e.g., `'production' !== 'production'` → `false`); DCE then
  // drops both the `if` body and the typeof guard. So the guard adds zero
  // bytes to a properly-bundled production build.
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.warn(...args);
  }
}
