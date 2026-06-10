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

describe('interaction mode CSS contract', () => {
  it('data-fbjs-interaction-mode="pan" rule body has cursor: grab + user-select: none', () => {
    const body = ruleBody(
      readStyle('interactionMode.css'),
      '.fbjs-container[data-fbjs-interaction-mode="pan"][data-overflowing="true"]',
    );
    expect(body).toMatch(/cursor:\s*grab/);
    expect(body).toMatch(/user-select:\s*none/);
  });

  it('data-fbjs-panning="true" adds cursor: grabbing', () => {
    const body = ruleBody(
      readStyle('interactionMode.css'),
      '.fbjs-container[data-fbjs-interaction-mode="pan"][data-overflowing="true"][data-fbjs-panning="true"]',
    );
    expect(body).toMatch(/cursor:\s*grabbing/);
  });

  it('flipbook.css imports interactionMode.css', () => {
    const css = stripComments(readStyle('flipbook.css'));
    expect(css).toMatch(/@import\s+['"]\.\/interactionMode\.css['"]/);
  });
});
