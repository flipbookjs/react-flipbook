// Step 8a Phase H.5 — cross-language roundtrip integration check.
//
// Asserts the search.rs writes → adapter reads tight loop works end-to-end
// across the Rust ↔ TypeScript boundary. Catches:
//   - search.json envelope shape mismatches (R10 guard fires)
//   - wrong tokenizer fold semantics (B1 parity gap)
//   - wrong item_index math (R7 invariant break)
//   - missing fields in SearchHit (R9 matchedToken)
//
// Adapter unit tests can't catch the same set because they mock the bundle
// URL; this test uses a real Rust-emitted bundle served over real HTTP.
//
// Run via (cwd = `dev/react-flipbook/`):
//   DYLD_LIBRARY_PATH=/Users/coder/DevProjects/publi-flipbook/week-0/experiment-1/pdfium/lib \
//     node scripts/8a-roundtrip-search-index.mjs
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
  process.env.DYLD_LIBRARY_PATH ?? '/Users/coder/DevProjects/publi-flipbook/week-0/experiment-1/pdfium/lib';
// uniform-3page has "Page 1" / "Page 2" / "Page 3" content + per-page black
// square. Tokenized folded form: "page" (appears on all 3 pages) + "1"/"2"/"3"
// (one each). We query "page" because it has multiple postings — exercises
// `findSingleToken`'s cap-at-page-boundary path AND gives the
// item_index → reconstructed-text-window verification multiple chances.
const QUERY = 'page';
const EXPECTED_MATCHED_TOKEN = 'page';

const ROOT = mkdtempSync(join(tmpdir(), '8a-roundtrip-'));
let server;

function shutdown(code, msg) {
  if (server) try { server.close(); } catch {}
  try { rmSync(ROOT, { recursive: true, force: true }); } catch {}
  if (msg) console.error(msg);
  process.exit(code);
}

try {
  // 1. Convert the fixture into the temp bundle root. DYLD set inside
  //    bash -c body (see PDFIUM_LIB_DIR comment).
  const bundleDir = join(ROOT, 'bundle');
  execSync(
    `bash -c 'export DYLD_LIBRARY_PATH="${PDFIUM_LIB_DIR}"; "${BIN}" convert "${FIXTURE}" --out "${bundleDir}"'`,
    { stdio: 'inherit' },
  );

  // 2. Spin up a tiny HTTP server serving the bundle directory. Native
  //    fetch does NOT reliably support file:// URLs, so we need real HTTP.
  server = createServer((req, res) => {
    const filePath = join(bundleDir, req.url || '/');
    if (!filePath.startsWith(bundleDir)) {
      // Path traversal guard — shouldn't happen for our own adapter, but
      // defensive.
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

  // 4. Search.
  const hits = await source.searchTerm(QUERY);
  if (hits.length === 0) {
    throw new Error(`roundtrip failed: zero hits for known token '${QUERY}'`);
  }
  if (hits[0].matchedToken !== EXPECTED_MATCHED_TOKEN) {
    throw new Error(
      `matchedToken=${hits[0].matchedToken}, expected '${EXPECTED_MATCHED_TOKEN}'`,
    );
  }
  if (typeof hits[0].pageIndex !== 'number') {
    throw new Error('SearchHit.pageIndex is not a number');
  }
  if (typeof hits[0].itemIndex !== 'number') {
    throw new Error('SearchHit.itemIndex is not a number');
  }
  if (typeof hits[0].contextSnippet !== 'string') {
    throw new Error('SearchHit.contextSnippet is not a string');
  }

  // 5. R7 invariant: SearchHit.itemIndex points at the FIRST per-character
  //    item of the matched token. Walk forward `[...matchedToken].length`
  //    items, concatenate text, fold via the §3.4 pipeline, and assert the
  //    result equals matchedToken.
  const items = await fetchTextJsonItems(hits[0].pageIndex, port);
  const charCount = [...hits[0].matchedToken].length;
  if (hits[0].itemIndex + charCount > items.length) {
    throw new Error(
      `itemIndex (${hits[0].itemIndex}) + token length (${charCount}) > items.length (${items.length})`,
    );
  }
  const reconstructed = items
    .slice(hits[0].itemIndex, hits[0].itemIndex + charCount)
    .map((i) => i.text)
    .join('');
  const folded = reconstructed
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC');
  if (folded !== hits[0].matchedToken) {
    throw new Error(
      `reconstructed='${reconstructed}' folded='${folded}', matchedToken='${hits[0].matchedToken}'`,
    );
  }

  console.log(
    `roundtrip OK — ${hits.length} hits, first hit at page ${hits[0].pageIndex} item ${hits[0].itemIndex}, snippet="${hits[0].contextSnippet}"`,
  );
  shutdown(0);
} catch (err) {
  shutdown(1, `roundtrip FAILED: ${err.message}\n${err.stack ?? ''}`);
}

async function fetchTextJsonItems(pageIndex, port) {
  // Mirror the adapter's pageNumberDigits=4 default convention. The H.5
  // fixture is uniform-3page (3 pages → 4 digits per
  // compute_page_number_digits).
  const pageId = String(pageIndex + 1).padStart(4, '0');
  const res = await fetch(`http://127.0.0.1:${port}/pages/${pageId}/text.json`);
  if (!res.ok) throw new Error(`text.json fetch failed: ${res.status} ${res.statusText}`);
  const { items } = await res.json();
  return items;
}
