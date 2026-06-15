import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readStyle(name: string): string {
  return readFileSync(resolve(__dirname, '../styles', name), 'utf-8');
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function ruleBody(css: string, selector: string): string {
  const cleaned = stripComments(css);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`);
  const match = cleaned.match(re);
  if (!match) throw new Error(`selector "${selector}" not found in CSS`);
  return match[1];
}

function selectorPresent(css: string, selector: string): boolean {
  const cleaned = stripComments(css);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{`);
  return re.test(cleaned);
}

describe('.fbjs-thumbnail-panel layout contract', () => {
  it('thumbnails.css declares the closed state with max-height 0 + overflow hidden + transition', () => {
    const body = ruleBody(readStyle('thumbnails.css'), '.fbjs-thumbnail-panel');
    expect(body).toMatch(/max-height:\s*0/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/transition:\s*max-height/);
  });

  it('thumbnails.css does NOT declare a CSS open-state max-height — JS owns that value', () => {
    // The open-state max-height comes from an inline style set by
    // ThumbnailPanel's layout effect (measured `scrollHeight`). A CSS
    // `[data-open="true"] { max-height: ... }` rule would conflict with
    // the inline value depending on specificity and silently take over.
    // Assert the selector is absent so future regressions surface here.
    expect(
      selectorPresent(readStyle('thumbnails.css'), '.fbjs-thumbnail-panel[data-open="true"]'),
    ).toBe(false);
  });

  it('thumbnails.css does NOT pin the scroll strip to a fixed height', () => {
    // Plan §3: the strip is adaptive — its height equals whatever the
    // thumbnails compute to. A `height: 14rem` rule re-introduces the
    // original cropping bug. Negative-pin against the source.
    const body = ruleBody(readStyle('thumbnails.css'), '.fbjs-thumbnail-panel__scroll');
    expect(body).not.toMatch(/height:\s*14rem/);
  });

  it('thumbnails.css does NOT stretch buttons to fill the strip', () => {
    // Plan §3: `.fbjs-thumbnail-button { height: 100% }` re-introduces
    // the bug by forcing the button to match the (now-adaptive) strip
    // height rather than its content. Negative-pin against the source.
    const body = ruleBody(readStyle('thumbnails.css'), '.fbjs-thumbnail-button');
    expect(body).not.toMatch(/height:\s*100%/);
  });

  it('thumbnails.css does NOT flex-grow the canvas host', () => {
    // Plan §3: `.fbjs-thumbnail-button__canvas-host { flex: 1 }` overrode
    // the inline `height` from `resolveItemDimensions` — the root cause
    // of the cropping bug. Negative-pin so re-introduction fails CI.
    const body = ruleBody(readStyle('thumbnails.css'), '.fbjs-thumbnail-button__canvas-host');
    expect(body).not.toMatch(/flex:\s*1\b/);
  });

  it('thumbnails.css does NOT declare a canvas { width: 100%; height: 100% } rule under the host', () => {
    // Dead rule pre-1.0.3: ThumbnailCanvas inlines `rendered.style.width`
    // and `rendered.style.height` already, so this CSS only ever masked
    // real intent. Removed. Negative-pin against the source.
    const cleaned = stripComments(readStyle('thumbnails.css'));
    expect(cleaned).not.toMatch(/\.fbjs-thumbnail-button__canvas-host\s+canvas\s*\{/);
  });

  it('thumbnails.css respects prefers-reduced-motion', () => {
    const css = stripComments(readStyle('thumbnails.css'));
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it('flipbook.css imports thumbnails.css', () => {
    const css = stripComments(readStyle('flipbook.css'));
    expect(css).toMatch(/@import\s+['"]\.\/thumbnails\.css['"]/);
  });
});
