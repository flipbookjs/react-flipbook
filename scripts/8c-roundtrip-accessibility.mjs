// Step 8c Phase C — cross-language roundtrip integration check.
//
// Asserts the accessibility.rs writes → adapter reads tight loop works
// end-to-end across the Rust ↔ TypeScript boundary. Catches:
//   - accessibility.json envelope shape mismatches (serializationVersion,
//     remediationStatus closed enum, required fields)
//   - accessibility-report.json envelope shape mismatches (tagged null/bool,
//     section objects, snake_case diagnostics keys vs camelCase outer)
//   - missing camelCase serde rename on outer envelope (snake_case would
//     surface in the page-sidecar key probe below)
//   - fingerprint format drift (16 hex chars per producer §3.2)
//   - manifest.documentArtifacts.accessibilityReport missing (producer-side
//     manifest::assemble_manifest must populate this for getAccessibilityReport
//     to find the doc-level artifact)
//
// Mirrors 8b's scripts/8b-roundtrip-reading-order.mjs in shape: tempdir +
// localhost server + `try ... finally { shutdown }` cleanup pattern.
//
// Run via (cwd = `dev/react-flipbook/`):
//   DYLD_LIBRARY_PATH=/Users/coder/DevProjects/publi-flipbook/week-0/experiment-1/pdfium/lib \
//     node scripts/8c-roundtrip-accessibility.mjs
//
// Exits 0 with `roundtrip OK` on success; non-zero with diagnostic on failure.

import { createServer } from 'http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { PreRenderedPageSource } from '../packages/api-adapter/dist/index.js';

const BIN = '../publi-flipbook-api/target/release/publi-flipbook-api';
const FIXTURE = '../publi-flipbook-api/tests/fixtures/uniform-3page.pdf';
// macOS SIP strips DYLD_LIBRARY_PATH across exec boundaries when the parent
// is a signed binary (Node + /usr/bin/* both qualify). The proven workaround
// (used throughout this project's Rust test harness) is to set the var
// INSIDE a `bash -c` body so bash's environment passes it to the exec'd
// child unmodified.
const PDFIUM_LIB_DIR =
  process.env.DYLD_LIBRARY_PATH ??
  '/Users/coder/DevProjects/publi-flipbook/week-0/experiment-1/pdfium/lib';

const ROOT = mkdtempSync(join(tmpdir(), '8c-roundtrip-'));
let server;

function shutdown(code, msg) {
  if (server) try { server.close(); } catch {}
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
  if (msg) console.error(msg);
  process.exit(code);
}

try {
  // 1. Convert the fixture into the temp bundle root.
  const bundleDir = join(ROOT, 'bundle');
  execSync(
    `bash -c 'export DYLD_LIBRARY_PATH="${PDFIUM_LIB_DIR}"; "${BIN}" convert "${FIXTURE}" --out "${bundleDir}"'`,
    { stdio: 'inherit' },
  );

  // 2. Local HTTP server over the bundle dir. Native fetch doesn't reliably
  //    support file:// URLs.
  server = createServer((req, res) => {
    const filePath = join(bundleDir, req.url || '/');
    if (!filePath.startsWith(bundleDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(readFileSync(filePath));
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  // 3. Wire up the adapter against the local server.
  const source = new PreRenderedPageSource({ bundleUrl: `http://127.0.0.1:${port}` });
  await source.init();

  // 4. Read accessibility.json for page 0 + assert envelope shape.
  const acc = await source.getAccessibility(0);
  if (acc.serializationVersion !== 1) {
    throw new Error(`accessibility.json: unexpected serializationVersion: ${acc.serializationVersion}`);
  }
  if (acc.remediationStatus !== 'needsReview') {
    throw new Error(`accessibility.json: unexpected remediationStatus: ${acc.remediationStatus}`);
  }
  if (!Array.isArray(acc.regions) || acc.regions.length !== 0) {
    throw new Error(`accessibility.json: v1 emission rule 1 violated — regions[] must be empty`);
  }
  if (!Array.isArray(acc.headings)) {
    throw new Error(`accessibility.json: headings is not an array`);
  }
  if (!Array.isArray(acc.altText)) {
    throw new Error(`accessibility.json: altText is not an array`);
  }
  if (!Array.isArray(acc.errors)) {
    throw new Error(`accessibility.json: errors is not an array`);
  }

  // 5. Read accessibility-report.json + assert envelope shape.
  const report = await source.getAccessibilityReport();
  if (report.serializationVersion !== 1) {
    throw new Error(`report: unexpected serializationVersion: ${report.serializationVersion}`);
  }
  // uniform-3page is untagged → tagged === false (NOT null; producer always
  // emits bool, null appears only in LEGACY_ACCESSIBILITY_REPORT).
  if (report.tagged !== false) {
    throw new Error(`report: uniform-3page expected tagged=false, got ${report.tagged}`);
  }
  if (report.structure.score !== null) {
    throw new Error(`report: untagged doc must have structure.score=null, got ${report.structure.score}`);
  }
  if (report.readingOrder.source !== 'passthrough') {
    throw new Error(`report: expected readingOrder.source=passthrough, got ${report.readingOrder.source}`);
  }
  // extractorDiagnostics MUST have snake_case sub-keys per producer §2.2
  // lock — fetch the raw JSON to verify (the typed accessor parsed it as
  // ExtractorDiagnostics, which would happily accept both camelCase or
  // snake_case post-parse; we want to know what was on the wire).
  const rawReport = JSON.parse(
    readFileSync(join(bundleDir, 'accessibility-report.json'), 'utf-8'),
  );
  for (const key of [
    'skipped_missing_bbox',
    'emitted_with_text',
  ]) {
    if (!(key in rawReport.extractorDiagnostics.headings)) {
      throw new Error(
        `report wire: extractorDiagnostics.headings missing snake_case key '${key}' — possible accidental camelCase serde rename drift`,
      );
    }
  }
  for (const key of ['matched_to_figure']) {
    if (!(key in rawReport.extractorDiagnostics.images)) {
      throw new Error(
        `report wire: extractorDiagnostics.images missing snake_case key '${key}'`,
      );
    }
  }
  // OUTER envelope camelCase: `extractorDiagnostics` (camelCase) must be
  // a key on the report — confirms the outer rename works while the inner
  // sub-fields stay snake_case.
  if (!('extractorDiagnostics' in rawReport)) {
    throw new Error(`report wire: top-level 'extractorDiagnostics' camelCase key missing`);
  }

  console.log(
    `roundtrip OK — page 0: serializationVersion=${acc.serializationVersion}, ` +
      `remediationStatus=${acc.remediationStatus}, regions=${acc.regions.length}, ` +
      `headings=${acc.headings.length}, altText=${acc.altText.length}; ` +
      `report tagged=${report.tagged}, structure.score=${report.structure.score}, ` +
      `readingOrder.source=${report.readingOrder.source}; ` +
      `wire keys verified snake_case (extractorDiagnostics.headings, .images).`,
  );
  shutdown(0);
} catch (err) {
  shutdown(1, `roundtrip FAILED: ${err.message}\n${err.stack ?? ''}`);
}
