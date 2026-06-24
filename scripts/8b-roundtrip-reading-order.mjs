// Step 8b Phase C — cross-language roundtrip integration check.
//
// Asserts the reading_order.rs writes → adapter reads tight loop works
// end-to-end across the Rust ↔ TypeScript boundary. Catches:
//   - reading-order.json envelope shape mismatches (serializationVersion,
//     source-discriminator, per-block selector mutual-exclusion)
//   - missing camelCase serde rename (snake_case keys would surface here)
//   - itemRange[0] → text.json::items[i] index drift (R7-style invariant)
//   - per-block rect non-finite coords (isRectTuple guard fires here too)
//
// Adapter unit tests can't catch the same set because they mock the bundle
// URL; this test uses a real Rust-emitted bundle served over real HTTP.
//
// Mirrors 8a's scripts/8a-roundtrip-search-index.mjs in shape: tempdir +
// localhost server + `try ... finally { shutdown }` cleanup pattern.
//
// Run via (cwd = `dev/react-flipbook/`):
//   DYLD_LIBRARY_PATH=/Users/coder/DevProjects/publi-flipbook/week-0/experiment-1/pdfium/lib \
//     node scripts/8b-roundtrip-reading-order.mjs
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

const ROOT = mkdtempSync(join(tmpdir(), '8b-roundtrip-'));
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

  // 4. Read the reading-order sidecar for page 0.
  const ro = await source.getReadingOrder(0);
  if (ro.serializationVersion !== 1) {
    throw new Error(`unexpected serializationVersion: ${ro.serializationVersion}`);
  }
  if (ro.source !== 'passthrough') {
    throw new Error(`unexpected source: ${ro.source} (uniform-3page is untagged)`);
  }
  if (!Array.isArray(ro.blocks)) {
    throw new Error(`blocks is not an array`);
  }
  if (!Array.isArray(ro.order)) {
    throw new Error(`order is not an array`);
  }
  if (!Array.isArray(ro.errors)) {
    throw new Error(`errors is not an array`);
  }

  // 5. Per §6 acceptance-gate item 8: for the first non-empty block, resolve
  //    the block's first item via the selector (itemRange[0] or items[0]),
  //    walk that index back into text.json::items[], and assert it's a
  //    valid TextItem with a string `.text` field. Skip when blocks empty.
  if (ro.blocks.length === 0) {
    console.log(`roundtrip OK — page 0 emitted empty blocks (legitimate for image-only / placeholder pages); R7 walk skipped per §6 rule.`);
    shutdown(0);
  }

  const block = ro.blocks[0];
  let firstItemIndex;
  if (block.itemRange !== undefined) {
    if (!Array.isArray(block.itemRange) || block.itemRange.length !== 2) {
      throw new Error(`block.itemRange malformed: ${JSON.stringify(block.itemRange)}`);
    }
    firstItemIndex = block.itemRange[0];
  } else if (block.items !== undefined) {
    if (!Array.isArray(block.items) || block.items.length === 0) {
      throw new Error(`block.items malformed or empty: ${JSON.stringify(block.items)}`);
    }
    firstItemIndex = block.items[0];
  } else {
    throw new Error(`block has neither itemRange nor items (adapter should have rejected)`);
  }
  if (!Number.isInteger(firstItemIndex) || firstItemIndex < 0) {
    throw new Error(`firstItemIndex is not a non-negative integer: ${firstItemIndex}`);
  }

  const items = await fetchTextJsonItems(0, port);
  if (firstItemIndex >= items.length) {
    throw new Error(
      `firstItemIndex (${firstItemIndex}) >= text.json items.length (${items.length})`,
    );
  }
  const item = items[firstItemIndex];
  if (typeof item.text !== 'string') {
    throw new Error(`text.json items[${firstItemIndex}].text is not a string`);
  }

  console.log(
    `roundtrip OK — page 0: ${ro.blocks.length} block(s), source=${ro.source}, ` +
      `first block kind=${block.kind} selector=${block.itemRange ? 'itemRange' : 'items'} ` +
      `→ text.json::items[${firstItemIndex}].text=${JSON.stringify(item.text)}`,
  );
  shutdown(0);
} catch (err) {
  shutdown(1, `roundtrip FAILED: ${err.message}\n${err.stack ?? ''}`);
}

async function fetchTextJsonItems(pageIndex, port) {
  const pageId = String(pageIndex + 1).padStart(4, '0');
  const res = await fetch(`http://127.0.0.1:${port}/pages/${pageId}/text.json`);
  if (!res.ok) throw new Error(`text.json fetch failed: ${res.status} ${res.statusText}`);
  const { items } = await res.json();
  return items;
}
