import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Pins the `.fbjs-root` layout contract introduced as a post-6C bugfix.
 *
 * 6C wrapped `.fbjs-container` in a new `.fbjs-root` div but the wrapper
 * rule only declared CSS custom properties — no layout, no theming, no
 * containment. The previously-shipped `.fbjs-container { height: 100% }`
 * then resolved to 0 because its new parent had no height → blank viewer.
 *
 * vitest doesn't process CSS imports into JSDOM by default, so a
 * `getComputedStyle`-based test would silently always pass. Instead this
 * test reads `theme.css` + `flipbook.css` directly and asserts the required
 * properties are present in the source. Catches anyone who deletes the
 * rules during a refactor.
 */

function readStyle(name: string): string {
  return readFileSync(resolve(__dirname, '../styles', name), 'utf-8');
}

function stripComments(css: string): string {
  // Strip /* ... */ comments so assertions only see real declarations.
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBody(css: string, selector: string): string {
  // Strip comments first so the selector match isn't confused by examples
  // inside comments, and so the returned body is free of comment literals
  // (assertions match only real declarations).
  const cleaned = stripComments(css);
  // Escape regex specials in selector; capture the first balanced-ish block
  // (CSS rules in this codebase don't nest other rules inside, so the first
  // closing brace is the rule's end).
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`);
  const match = cleaned.match(re);
  if (!match) throw new Error(`selector "${selector}" not found in CSS`);
  return match[1];
}

describe('.fbjs-root layout contract (regression: post-6C blank-screen bug)', () => {
  it('theme.css declares .fbjs-root as a flex column with pass-through sizing', () => {
    const body = ruleBody(readStyle('theme.css'), '.fbjs-root');
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/width:\s*100%/);
    expect(body).toMatch(/height:\s*100%/);
  });

  it('theme.css declares .fbjs-root as a positioned containing block + isolated stacking context', () => {
    const body = ruleBody(readStyle('theme.css'), '.fbjs-root');
    expect(body).toMatch(/position:\s*relative/);
    expect(body).toMatch(/box-sizing:\s*border-box/);
    expect(body).toMatch(/isolation:\s*isolate/);
  });

  it('theme.css applies the theme tokens to .fbjs-root (so dark mode actually looks dark)', () => {
    const body = ruleBody(readStyle('theme.css'), '.fbjs-root');
    expect(body).toMatch(/background-color:\s*var\(--fbjs-bg\)/);
    expect(body).toMatch(/color:\s*var\(--fbjs-fg\)/);
  });

  it('flipbook.css declares .fbjs-container as flex-grow (NOT height:100%) so it fills .fbjs-root', () => {
    const body = ruleBody(readStyle('flipbook.css'), '.fbjs-container');
    expect(body).toMatch(/flex:\s*1\s+1\s+0/);
    expect(body).toMatch(/min-height:\s*0/);
    // The old `height: 100%` rule MUST NOT come back — it collapsed in 6C's
    // wrapper hierarchy. flex sizing handles vertical fill correctly with or
    // without the optional toolbar slots present.
    expect(body).not.toMatch(/height:\s*100%/);
  });
});
