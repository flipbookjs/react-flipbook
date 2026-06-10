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

describe('.fbjs-thumbnail-panel layout contract', () => {
  it('thumbnails.css declares the closed state with max-height 0 + overflow hidden + transition', () => {
    const body = ruleBody(readStyle('thumbnails.css'), '.fbjs-thumbnail-panel');
    expect(body).toMatch(/max-height:\s*0/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/transition:\s*max-height/);
  });

  it('thumbnails.css opens the panel via [data-open="true"]', () => {
    // Raw CSS selector — escape function in `ruleBody` handles regex-escaping
    // of `[` and `]`. Passing `\\[` / `\\]` here would double-escape, producing
    // a regex that matches a literal backslash + bracket (no CSS rule does).
    const body = ruleBody(readStyle('thumbnails.css'), '.fbjs-thumbnail-panel[data-open="true"]');
    expect(body).toMatch(/max-height:\s*14rem/);
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
