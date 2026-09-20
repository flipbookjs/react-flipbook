# Migration Guide — `@flipbookjs/react-viewer@4.0.0`

> Audience: integration owners upgrading from `3.x` to `4.0.0`.
> Companions: `MIGRATION-v3.md`, `MIGRATION-v2.md`, `MIGRATION.md` — all still apply
> for every prop, hook, action, state field and CSS class not mentioned here.

## 1. What changed

1. **pdf.js 6 is required.** The peer dependency moves from `^5.6.0` to
   `>=6.2.108 <7`. pdf.js `>=5.6.83 <6.2.108` is affected by GHSA-hq66-cqwq-w95j
   (CVE-2026-16633, arbitrary JavaScript execution on a malicious PDF) and there is
   no 5.x fix.
2. **pdf.js is no longer bundled.** Earlier versions compiled pdf.js and its worker
   into the package, so the peer dependency had no runtime effect. 4.0.0 imports
   `pdfjs-dist` at runtime: your installed copy is what runs, your patches apply, and
   your audit tooling sees it.
3. **A worker URL is now required.** There is no built-in default.

## 2. What you must do

```bash
npm install pdfjs-dist@^6.2.108
```

```js
// Vite
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { configurePdfWorker } from '@flipbookjs/react-viewer';

configurePdfWorker(workerSrc); // once, at app startup
```

The `?url` suffix is Vite's; in TypeScript it needs `vite/client` types in scope
(Vite's scaffold provides them via `src/vite-env.d.ts`), otherwise TypeScript reports
`TS2307` for that specifier. With another bundler, copy
`pdfjs-dist/build/pdf.worker.min.mjs` into your static assets and pass that URL.

Per-instance instead of at startup:

```jsx
<Flipbook url={url} pdfjsOptions={{ workerSrc }} />
```

Already self-hosting? Point at your copy — `configurePdfWorker('/pdf.worker.mjs')` —
and re-copy it from `node_modules/pdfjs-dist/build/` when you upgrade pdf.js. The
worker and the library must be the same version; pdf.js throws
`The API version "X" does not match the Worker version "Y"` otherwise.

A CDN copy works too, and pdf.js loads a cross-origin worker by wrapping it in a blob,
which needs `worker-src blob:` in your CSP:

```js
import * as pdfjs from 'pdfjs-dist';
configurePdfWorker(
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`,
);
```

If neither a `workerSrc` nor `pdfjs.GlobalWorkerOptions.workerSrc` is set, `init()`
throws with these options named, and the viewer shows its error state. The resolution
order is: explicit `workerSrc` → an already-set `GlobalWorkerOptions.workerSrc`
(respected, never overwritten) → throw.

## 3. Node

The package now declares `engines.node: ">=22.13.0 || >=24"`, which is pdfjs-dist 6's
own floor. The browser runtime is unaffected, but installing and building the
application still requires Node 22.13+ where engine constraints are enforced.

That floor is about installing, not about running the viewer in Node. This package
targets browsers: pdf.js's browser build touches DOM globals while it evaluates — on
6.2.108, `new DOMMatrix()` runs at module scope — so importing or `require()`-ing the
viewer in a bare Node process throws `ReferenceError: DOMMatrix is not defined`
whatever the Node version. (6.3.289 defers that particular construction, but the
constraint stands in general.) This is unchanged from 3.x, which bundled a pdf.js with
the same behavior. Server-rendering frameworks must keep the viewer inside a client
boundary — see `MIGRATION.md` §13, which already requires this.

## 4. Runtime assets

`wasmUrl`, `standardFontDataUrl`, `cMapUrl` and `iccUrl` are unchanged: they still
default to jsDelivr pinned to your installed `pdfjs.version`, and they still fail soft
(a PDF needing JPEG2000, JBIG2, ICC, CJK or a standard-14 font renders without it). If
you self-host these directories, re-copy them after upgrading — pdf.js 6 adds files to
`wasm/`.

Worth knowing what those defaults fetch: `wasmUrl` serves WebAssembly that runs in the
pdf.js worker, and when WebAssembly is unavailable pdf.js falls back to plain
JavaScript from the same directory (`openjpeg_nowasm_fallback.js`,
`jbig2_nowasm_fallback.js`). Subresource integrity cannot be applied to these runtime
fetches. If your threat model doesn't accept executable code from a public CDN, set
all four options to copies you host — which is also what a strict `script-src` /
`connect-src` policy will require.

## 5. Sizes

The package's main entry drops from 2.11 MB to roughly 45 KB, because the embedded
pdf.js and its base64-inlined worker are gone. Your application still bundles pdf.js —
now from your own `node_modules`, deduplicated with any other use of it in your app.

## 6. Unchanged

Every prop, hook, action, state field, CSS class, custom property and export other
than the two noted above. `PdfjsSource`, `PdfjsSourceOptions` and `configurePdfWorker`
keep their names and signatures.
