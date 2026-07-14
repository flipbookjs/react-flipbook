/**
 * Fixture generator for `doc_smoke_3pg` — renders 3 pages of a source PDF
 * to WebP at the 4-tier ladder (512 / 1024 / 2048 / 4096) per D10, then
 * extracts text + links + outline via pdf.js and writes the matching
 * sidecar JSON files per spec §6.
 *
 * Run from the api-adapter package directory:
 *   npx tsx scripts/generate-fixture.ts
 *
 * Idempotent: overwrites existing WebPs and sidecar JSON files. Does NOT
 * overwrite the hand-authored manifest.json, seo.json, search.json,
 * accessibility-report.json placeholders (those carry decisions the
 * generator doesn't know about — contentHash, SEO copy, etc.).
 *
 * Per A6 / D10 / Phase 2: renders ONCE at the 4096-px tier scale and
 * downsamples to each tier — matches the plan's "one render, downsample
 * three times" workaround verbatim. The fixture's purpose is contract
 * validation, not visual benchmarking.
 */

import { createCanvas } from '@napi-rs/canvas';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../../..');
const SOURCE_PDF = resolve(REPO_ROOT, 'test-pdfs/test.pdf');
const FIXTURE_DIR = resolve(__dirname, '../fixtures/doc_smoke_3pg');

const PAGES_TO_RENDER = [1, 2, 3];           // 1-indexed (pdf.js convention)
const TIER_WIDTHS = [512, 1024, 2048, 4096]; // per D10
const PAGE_NUMBER_DIGITS = 4;                // per D2 / manifest.defaults
const SOURCE_PAGE_WIDTH = 594;               // test.pdf page width (verified)
const RENDER_SCALE_AT_MAX_TIER = 4096 / SOURCE_PAGE_WIDTH;

interface PageRender {
  pageIndex: number;
  pageId: string;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

/**
 * Convert a pdf.js text item to the spec §6.1 TextItem shape. pdf.js gives
 * us a baseline-origin (PDF convention); the spec expects top-left CSS
 * origin. We convert: y_css = pageHeight - baseline_y - height.
 */
interface PdfjsTextItem {
  str: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
  fontName?: string;
}

function convertTextItem(item: PdfjsTextItem, pageHeight: number): Record<string, unknown> {
  const [, , , scaleY, x, y] = item.transform;
  const fontSize = Math.abs(scaleY);
  return {
    text: item.str,
    x,
    y: pageHeight - y - item.height,
    width: item.width,
    height: item.height,
    fontSize,
  };
}

interface PdfjsAnnotation {
  subtype: string;
  rect: [number, number, number, number]; // PDF coords: [x1, y1, x2, y2] bottom-left
  url?: string;
  dest?: unknown;
}

// Sidecar-side scheme sanitizer. Bake-time doesn't know the future
// consumer's `additionalLinkSchemes` config, so the baker restricts to the
// runtime DEFAULT allowlist. Consumers who need custom schemes at their
// PdfjsSource path still get them; the pre-baked path is default-only by
// design. Baking irrevocably deletes data, so being restrictive at bake
// keeps unsafe URLs out of persistent storage.
const BAKER_ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const FORBIDDEN_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file']);

function isSafeBakerUrl(url: string): boolean {
  const m = url.trim().match(/^([a-z][a-z0-9+.-]*):/i);
  const scheme = m?.[1]?.toLowerCase();
  if (!scheme) return false;
  if (FORBIDDEN_SCHEMES.has(scheme)) return false;
  return BAKER_ALLOWED_SCHEMES.has(scheme);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function convertLinkAnnotation(
  ann: PdfjsAnnotation,
  page: any,
  doc: any,
): Promise<Record<string, unknown> | null> {
  // Payload-shape filter — keep sidecar sanitizer aligned with runtime.
  if (ann.subtype !== 'Link') return null;
  if ((ann as any).actions) return null;
  if ((ann as any).action != null) return null;
  if ((ann as any).attachment) return null;
  if ((ann as any).setOCGState) return null;
  if ((ann as any).resetForm) return null;

  const viewport = page.getViewport({ scale: 1.0 });
  const raw = viewport.convertToViewportRectangle(ann.rect);
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const [x1, y1, x2, y2] = raw;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const rect: [number, number, number, number] = [
    Math.min(x1, x2), Math.min(y1, y2),
    Math.max(x1, x2), Math.max(y1, y2),
  ];
  if (rect[2] <= rect[0] || rect[3] <= rect[1]) return null;

  if (ann.url) {
    const url = ann.url.trim();
    if (!isSafeBakerUrl(url)) return null;
    return { rect, url };
  }
  if ((ann as any).dest == null) return null;

  try {
    const dest = typeof (ann as any).dest === 'string'
      ? await doc.getDestination((ann as any).dest)
      : (ann as any).dest;
    if (!Array.isArray(dest) || dest.length === 0) return null;
    const destPage = await doc.getPageIndex(dest[0]);
    if (typeof destPage !== 'number') return null;
    return { rect, destPage };
  } catch {
    // Malformed dest, missing bookmark, or unresolvable dest — drop.
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
async function extractOutline(doc: any): Promise<Record<string, unknown>[]> {
  const raw = await doc.getOutline();
  if (!Array.isArray(raw)) return [];
  const walk = async (entries: any[]): Promise<Record<string, unknown>[]> => {
    const out: Record<string, unknown>[] = [];
    for (const entry of entries) {
      let pageIndex = 0;
      if (Array.isArray(entry.dest) && entry.dest.length > 0) {
        try {
          const ref = entry.dest[0];
          const idx = await doc.getPageIndex(ref);
          if (typeof idx === 'number') pageIndex = idx;
        } catch {
          /* ignore destination resolution failures — fixture data */
        }
      }
      const node: Record<string, unknown> = {
        title: entry.title ?? '',
        pageIndex,
      };
      if (Array.isArray(entry.items) && entry.items.length > 0) {
        node.children = await walk(entry.items);
      }
      out.push(node);
    }
    return out;
  };
  return walk(raw);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function main(): Promise<void> {
  console.log(`[generate-fixture] Source PDF: ${SOURCE_PDF}`);
  console.log(`[generate-fixture] Output dir: ${FIXTURE_DIR}`);

  // pdf.js v5 legacy build is the Node-friendly entry. The browser/worker
  // entries assume a window global.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const pdfBytes = new Uint8Array(readFileSync(SOURCE_PDF));
  const doc = await getDocument({
    data: pdfBytes,
    disableFontFace: true,
  }).promise;

  if (doc.numPages < PAGES_TO_RENDER.length) {
    throw new Error(
      `Source PDF has ${doc.numPages} pages but fixture needs ${PAGES_TO_RENDER.length}.`,
    );
  }

  // Copy source.pdf into the bundle (per D11 — optional but exercised here).
  mkdirSync(FIXTURE_DIR, { recursive: true });
  copyFileSync(SOURCE_PDF, resolve(FIXTURE_DIR, 'source.pdf'));
  console.log('[generate-fixture] copied source.pdf');

  // outline.json (doc-level)
  const outlineItems = await extractOutline(doc);
  writeFileSync(
    resolve(FIXTURE_DIR, 'outline.json'),
    JSON.stringify({ items: outlineItems }, null, 2) + '\n',
  );
  console.log(`[generate-fixture] wrote outline.json (${outlineItems.length} top-level items)`);

  const renders: PageRender[] = [];

  for (const pdfPageNumber of PAGES_TO_RENDER) {
    const page = await doc.getPage(pdfPageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderViewport = page.getViewport({ scale: RENDER_SCALE_AT_MAX_TIER });

    const canvas = createCanvas(renderViewport.width, renderViewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, renderViewport.width, renderViewport.height);

    await page.render({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas: canvas as any,
      viewport: renderViewport,
    }).promise;

    const pageIndex = pdfPageNumber - 1;
    const pageId = String(pdfPageNumber).padStart(PAGE_NUMBER_DIGITS, '0');
    const pageOutDir = resolve(FIXTURE_DIR, 'pages', pageId);
    mkdirSync(pageOutDir, { recursive: true });

    // WebP tiers
    for (const tierWidth of TIER_WIDTHS) {
      const tierHeight = Math.round(
        tierWidth * (renderViewport.height / renderViewport.width),
      );
      const tierCanvas = createCanvas(tierWidth, tierHeight);
      const tierCtx = tierCanvas.getContext('2d');
      tierCtx.fillStyle = '#ffffff';
      tierCtx.fillRect(0, 0, tierWidth, tierHeight);
      tierCtx.drawImage(canvas, 0, 0, tierWidth, tierHeight);
      const webp = await tierCanvas.encode('webp');
      writeFileSync(resolve(pageOutDir, `width-${tierWidth}.webp`), webp);
    }
    console.log(`[generate-fixture] page ${pageId}: 4 WebP tiers written`);

    // text.json — per spec §6.1
    const textContent = await page.getTextContent();
    const textItems = (textContent.items as PdfjsTextItem[]).map((it) =>
      convertTextItem(it, baseViewport.height),
    );
    writeFileSync(
      resolve(pageOutDir, 'text.json'),
      JSON.stringify({ items: textItems }, null, 2) + '\n',
    );

    // links.json — per spec §6.2
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const annotations = (await page.getAnnotations()) as PdfjsAnnotation[];
    const links = (
      await Promise.all(
        annotations.map((a) => convertLinkAnnotation(a, page, doc)),
      )
    ).filter((x): x is Record<string, unknown> => x !== null);
    writeFileSync(
      resolve(pageOutDir, 'links.json'),
      JSON.stringify({ links }, null, 2) + '\n',
    );

    // accessibility.json — placeholder per D6 / spec §6.5 (reserved name,
    // empty object until format is locked in a future 1.x minor).
    writeFileSync(
      resolve(pageOutDir, 'accessibility.json'),
      JSON.stringify({}, null, 2) + '\n',
    );

    console.log(
      `[generate-fixture] page ${pageId}: text=${textItems.length} links=${links.length} sidecars written`,
    );

    renders.push({
      pageIndex,
      pageId,
      width: baseViewport.width,
      height: baseViewport.height,
      rotation: ((baseViewport.rotation % 360) as 0 | 90 | 180 | 270),
    });
  }

  await doc.destroy();

  console.log('\n[generate-fixture] Page dimensions (for manifest.json):');
  for (const r of renders) {
    console.log(`  page ${r.pageId}: size=[${r.width}, ${r.height}], rotation=${r.rotation}`);
  }
  console.log('\n[generate-fixture] Done.');
}

main().catch((err) => {
  console.error('[generate-fixture] FAILED:', err);
  process.exit(1);
});
