# `@flipbookjs/api-adapter` test fixtures

Hand-authored artifact bundles used as the empirical contract anchor for the
adapter and its validator. Fixtures live HERE (package-owned) rather than under
`demo/public/` so the package is self-contained — `npm -w packages/api-adapter test`
reads bytes from `../fixtures/`, and the demo's `vite.config.ts` middleware
serves the same bytes at runtime via `/fixtures/*` (see top-level `demo/vite.config.ts`).

## Bundles

### `doc_smoke_3pg/` — 3-page smoke fixture

| Aspect | Value |
|---|---|
| Pages | 3 (rendered from `test-pdfs/test.pdf` pages 1-3) |
| Page size | 594 × 792 (uniform per D13) |
| Tier ladder | 512 / 1024 / 2048 / 4096 (per D10) |
| Sidecars per page | `text.json`, `links.json`, `accessibility.json` (placeholder) |
| Doc-level | `outline.json`, `seo.json`, `search.json` (placeholder), `accessibility-report.json` (placeholder) |
| Source PDF | `source.pdf` (a copy of `test-pdfs/test.pdf`) |

This fixture embodies these decisions from the locked contract:

- **D1** — manifest schema with `manifestVersion: 1` + lean defaults + no overrides.
- **D2** — relative-path URL templates; cache-control is operator-deployment concern, not in fixture.
- **D5** — sidecar shapes match the `TextItem`/`LinkAnnotation`/`OutlineItem` exports from `@flipbookjs/react-viewer`.
- **D6 / D7** — `seo.json` populated; `search.json` + `accessibility-report.json` + `pages/*/accessibility.json` are reserved-name placeholders (empty `{}`).
- **D10** — 4-tier image ladder (`512 / 1024 / 2048 / 4096`).
- **D11** — `documentArtifacts.sourcePdf: "source.pdf"` exercises the `getSourceUrl()` path.
- **D13** — every `pages[i].size` is identical (594 × 792).
- **D14** — all reference fields are relative bundle paths (Part 1); `sourcePdf` is relative too.

## Regenerating

Run from the api-adapter package directory:

```bash
npx tsx scripts/generate-fixture.ts
```

The script:
1. Loads `test-pdfs/test.pdf` (the source).
2. Renders pages 1-3 at the 4096-px tier scale onto an `@napi-rs/canvas`.
3. Downsamples to each tier width and encodes as WebP — matches A6's "one render, downsample three times" workaround.
4. Extracts text content + link annotations via pdf.js + writes per-page `text.json`, `links.json`, `accessibility.json` (empty).
5. Extracts the document outline + writes `outline.json`.
6. Copies `test.pdf` to `source.pdf`.

**Idempotent.** Overwrites WebPs + auto-generated sidecars on each run. Does NOT overwrite
`manifest.json`, `seo.json`, `search.json`, `accessibility-report.json` (those carry decisions
the generator doesn't know about — content hash, SEO copy, etc.). Update those by hand if the
source PDF changes.

After regenerating, recompute the manifest's `contentHash`:

```bash
shasum -a 256 fixtures/doc_smoke_3pg/source.pdf
```

Paste the digest into `manifest.json`'s `contentHash` field (with the `sha256:` prefix).

## Not shipped to consumers

`fixtures/` is dev-only. The api-adapter's `package.json` `files: ["dist"]` list excludes it from npm publishes.
