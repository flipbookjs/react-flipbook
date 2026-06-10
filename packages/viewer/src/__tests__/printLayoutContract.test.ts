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

describe('print CSS contract', () => {
  it('.fbjs-print-sheet has @media screen { display: none } + @media print { display: block }, BOTH rules OUTSIDE @layer flipbook (F1 hoist)', () => {
    const css = stripComments(readStyle('print.css'));

    // Find the byte offsets of the load-bearing print-display rule and the
    // @layer flipbook { opening. The hoist requires the rule to appear FIRST.
    const ruleOffset = css.search(/body\s*>\s*:not\(\.fbjs-print-sheet\)/);
    const layerOffset = css.search(/@layer\s+flipbook\s*\{/);
    expect(ruleOffset).toBeGreaterThanOrEqual(0);
    expect(layerOffset).toBeGreaterThanOrEqual(0);
    expect(ruleOffset).toBeLessThan(layerOffset);

    // @media screen block contains `.fbjs-print-sheet { display: none }`, and
    // the entire block lives BEFORE @layer flipbook (i.e., outside it).
    const screenMatch = css.match(/@media\s+screen\s*\{[\s\S]*?\.fbjs-print-sheet\s*\{[^}]*display\s*:\s*none[^}]*\}[\s\S]*?\}/);
    expect(screenMatch).not.toBeNull();
    expect(screenMatch!.index).toBeLessThan(layerOffset);

    // @media print block contains `.fbjs-print-sheet { display: block }`, ALSO
    // outside @layer.
    const printSheetBlockMatch = css.match(/@media\s+print\s*\{[\s\S]*?\.fbjs-print-sheet\s*\{[^}]*display\s*:\s*block[^}]*\}/);
    expect(printSheetBlockMatch).not.toBeNull();
    expect(printSheetBlockMatch!.index).toBeLessThan(layerOffset);
  });

  it('.fbjs-print-page has page-break-after: always', () => {
    const css = stripComments(readStyle('print.css'));
    // `.fbjs-print-page` rule body (the non-`:last-child` one) must include
    // page-break-after: always.
    const match = css.match(/\.fbjs-print-page\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/page-break-after:\s*always/);
  });

  it('flipbook.css imports print.css', () => {
    const css = stripComments(readStyle('flipbook.css'));
    expect(css).toMatch(/@import\s+['"]\.\/print\.css['"]/);
  });
});
