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

describe('.fbjs-loading contract', () => {
  // The document-level loading overlay uses absolute positioning inside
  // `.fbjs-container` so it stays centered independent of the flex row's
  // justify/align state. Spacing between the spinner and label lives on
  // `.fbjs-loading-label` as `margin-top`, not on `.fbjs-loading` as flex
  // `gap` — same convention already used elsewhere in the viewer.

  it('flipbook.css declares .fbjs-loading as an absolute overlay filling its container', () => {
    const body = ruleBody(readStyle('flipbook.css'), '.fbjs-loading');
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset:\s*0/);
  });

  it('flipbook.css spaces .fbjs-loading children via label margin, not flex gap', () => {
    const body = ruleBody(readStyle('flipbook.css'), '.fbjs-loading');
    expect(body).not.toMatch(/gap:/);
  });

  it('flipbook.css uses the muted-fg theme token for .fbjs-loading text color', () => {
    const body = ruleBody(readStyle('flipbook.css'), '.fbjs-loading');
    expect(body).toMatch(/color:\s*var\(--fbjs-fg-muted\)/);
  });

  it('flipbook.css uses theme tokens (not hardcoded hex) for .fbjs-loading-spinner border', () => {
    const body = ruleBody(readStyle('flipbook.css'), '.fbjs-loading-spinner');
    expect(body).toMatch(/border:\s*3px\s+solid\s+var\(--fbjs-border\)/);
    expect(body).toMatch(/border-top-color:\s*var\(--fbjs-accent\)/);
    // No hardcoded hex values on any .fbjs-loading* rule after the theming pass.
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('flipbook.css declares .fbjs-loading-label with deterministic spacing', () => {
    const body = ruleBody(readStyle('flipbook.css'), '.fbjs-loading-label');
    expect(body).toMatch(/margin-top:\s*0\.75rem/);
    expect(body).toMatch(/font-size:\s*0\.875rem/);
  });
});

describe('.fbjs-thumbnail-button current-affordance contract', () => {
  // The current-affordance style and the hover carve-out MUST stay symmetric:
  // both key on `[aria-current="page"]` AND `[data-current-spread="true"]`, or
  // the right thumbnail of a dual-cover spread visually loses its highlight
  // under hover (specificity fight). UI attribute-level tests would let a
  // source-level regression through — JSDOM doesn't compute CSS.

  it('thumbnails.css current-affordance selector matches BOTH aria-current AND data-current-spread', () => {
    const css = stripComments(readStyle('thumbnails.css'));
    // Both attribute selectors must appear together as a comma-separated list.
    expect(css).toMatch(/\.fbjs-thumbnail-button\[aria-current="page"\]\s*,\s*\.fbjs-thumbnail-button\[data-current-spread="true"\]/);
  });

  it('thumbnails.css hover carve-out excludes BOTH current markers', () => {
    const css = stripComments(readStyle('thumbnails.css'));
    // Hover rule must NOT apply when EITHER current marker is present.
    expect(css).toMatch(/\.fbjs-thumbnail-button:not\(\[aria-current="page"\]\):not\(\[data-current-spread="true"\]\):hover/);
  });
});
