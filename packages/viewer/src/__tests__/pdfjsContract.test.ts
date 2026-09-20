// @vitest-environment node
import { describe, it, expect } from 'vitest';

// Every other pdfjs test in this suite mocks 'pdfjs-dist', so the suite asserts a
// hand-written shape and cannot see a real pdf.js API change. This file imports the
// real library and pins the surface PdfjsSource depends on.
//
// The LEGACY build is deliberate: the browser build throws
// "hashOriginal.toHex is not a function" under Node (no Uint8Array.prototype.toHex).
// Both builds come from the same source, so the API shape is identical.

// A 461-byte PDF with one external Link annotation — no binary fixture to commit.
function minimalPdf(): Uint8Array {
  const objs = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Annots[4 0 R]>>endobj\n',
    '4 0 obj<</Type/Annot/Subtype/Link/Rect[10 20 90 60]/Border[0 0 0]' +
      '/A<</Type/Action/S/URI/URI(https://example.com/)>>>>endobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const o of objs) { offsets.push(pdf.length); pdf += o; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array([...pdf].map((c) => c.charCodeAt(0)));
}

describe('pdfjs-dist API contract', () => {
  it('loads a document, converts link coordinates, and tears down', async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const loadingTask = getDocument({ data: minimalPdf() });
    expect(typeof loadingTask.destroy).toBe('function');

    const doc = await loadingTask.promise;
    expect(doc.numPages).toBe(1);

    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    expect(typeof viewport.convertToViewportPoint).toBe('function');

    const [link] = (await page.getAnnotations()).filter((a) => a.subtype === 'Link');
    expect(link.url).toBe('https://example.com/');

    // The same conversion PdfjsSource.convertLink performs. MediaBox is 200x100, so
    // the PDF rect [10, 20, 90, 60] maps to viewport [10, 80, 90, 40] (y flipped).
    const [x1, y1, x2, y2] = [
      ...viewport.convertToViewportPoint(link.rect[0], link.rect[1]),
      ...viewport.convertToViewportPoint(link.rect[2], link.rect[3]),
    ];
    expect([x1, y1, x2, y2]).toEqual([10, 80, 90, 40]);

    await expect(loadingTask.destroy()).resolves.toBeUndefined();
  });

  it('exports the module-level symbols the viewer imports', async () => {
    const pdfjs = await import('pdfjs-dist');
    expect(typeof pdfjs.getDocument).toBe('function');
    // GlobalWorkerOptions is a class with static accessors, not a plain object —
    // what configurePdfWorker needs is the `workerSrc` accessor on it.
    expect(typeof pdfjs.GlobalWorkerOptions.workerSrc).toBe('string');
    expect(typeof pdfjs.version).toBe('string');
  });
});
