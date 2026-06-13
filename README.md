<!--
  Hero image goes here. Recommended: animated gif (~3-5 sec) showing the
  page-curl interaction + toolbar. Easiest workflow: drag-and-drop the
  image into a GitHub issue/discussion comment, copy the resulting
  user-attachments URL, and paste it below.

  <p align="center">
    <a href="https://github.com/flipbookjs/react-flipbook">
      <img alt="React PDF viewer with page curl and complete UI chrome" src="https://github.com/user-attachments/assets/..." />
    </a>
  </p>
-->

<h3 align="center">@flipbookjs/react-viewer</h3>

<p align="center">
  React PDF viewer with page-curl animation, full UI chrome, and SSR-safe hooks.
  <br />
  <br />
  <a href="#quick-start"><strong>Quick Start</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="packages/viewer/MIGRATION.md"><strong>Docs</strong></a> ·
  <a href="#production-grade-rendering-with-publi"><strong>publi (paid)</strong></a> ·
  <a href="#license"><strong>License</strong></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@flipbookjs/react-viewer">
    <img alt="npm version" src="https://img.shields.io/npm/v/@flipbookjs/react-viewer?label=npm&color=0bf" />
  </a>
  <a href="https://github.com/flipbookjs/react-flipbook/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/flipbookjs/react-flipbook?color=f80" />
  </a>
</p>

<br/>

## Introduction

A modern React PDF viewer that ships ready: built-in toolbar, page curl animation, thumbnails, fullscreen, print, download. Every interaction is keyboard-accessible with WAI-ARIA, themed light/dark, and SSR-safe on Next.js / Remix / Gatsby. Drop `<Flipbook url="..." />` into any React 18+ app — no plugin composition, no toolbar wiring, no pdf.js example surgery.

Built for product documentation portals, magazine + brochure CMSes, e-book apps, archival viewers, and embed-in-iframe widgets. TypeScript-first, MIT licensed.

## Quick Start

Install the package and its peer dependencies:

```bash
npm install @flipbookjs/react-viewer@1.0.0 pdfjs-dist react react-dom
```

Render the viewer:

```tsx
import { Flipbook } from '@flipbookjs/react-viewer';
import '@flipbookjs/react-viewer/styles.css';

export default function Reader() {
  return (
    <Flipbook
      url="/document.pdf"
      documentName="My Document"
      enablePageCurl
    />
  );
}
```

Toolbar, page navigation, zoom, fullscreen, print, download, thumbnails, and the page curl animation all render by default.

For Next.js, Remix, Gatsby, and other SSR frameworks, see [SSR integration in MIGRATION.md §13](packages/viewer/MIGRATION.md#13-ssr--nextjs--remix-integration).

## Features

### Ready out of the box

- **`<Flipbook url="..." />` drops in a complete viewer** — toolbar, navigation, zoom, fullscreen, print, download, thumbnails, theme. No setup, no plugins, no glue.
- **Page-curl animation** — opt in with `enablePageCurl`; tactile dual-page interaction in dual-cover mode.
- **Built-in toolbar** — every action accessible via keyboard with WAI-ARIA roving-tabindex; `aria-pressed` on toggles; reduced-motion respected on animated parts.
- **Thumbnail panel** — virtualized horizontal scroll, click-to-navigate, slide animation that defers to `prefers-reduced-motion`.
- **Streaming print** — per-page render keeps memory bounded; cancellable mid-flight; typed errors (`PrintLimitExceededError`); analytics callbacks (`onPrintStart`, `onPrintComplete`, `onPrintError`, `onPrintAbort`).
- **Smart download** — derives filename from `documentName` or URL basename; sanitizes OS-illegal characters; URL-decoded to strip `%20`-style noise.
- **Theme runtime** — light/dark via `initialTheme` + `onThemeChange`; restyle with `--fbjs-*` CSS variables, no class overrides needed.

### Composable when you outgrow defaults

- **Toolbar parts** — 12 button components + `<ToolbarShell>` exported from `@flipbookjs/react-viewer/toolbar-parts`. Build your own bar; keep the accessibility.
- **Public hooks** — `useFlipbook()` for full state, `useFlipbookSelector()` for narrow subscriptions, `useFlipbookActions()` for stable-identity dispatch, `shallowEqual` helper.
- **Custom PDF sources** — implement the `PageSource` interface for `Uint8Array` documents, custom HTTP, or pre-rendered image tiles via [publi](#production-grade-rendering-with-publi).

### Developer ergonomics

- **TypeScript-first** — every prop, hook, action, and type fully declared. No `any`, no implicit erasure.
- **SSR-safe** — frozen sentinels for server renders; concrete patterns for Next.js App Router / Pages Router / Remix / Gatsby in [MIGRATION.md §13](packages/viewer/MIGRATION.md#13-ssr--nextjs--remix-integration).
- **React 18+** — uses `useSyncExternalStore` for the snapshot store; safe under concurrent rendering and Strict Mode.

## Documentation

- **[MIGRATION.md](packages/viewer/MIGRATION.md)** — full integration guide. Every prop with type/default/semantic, default-flip notes, iframe embedding requirements (sandbox tokens + Permissions Policy + `allowfullscreen`), toolbar-parts composition examples, theme/print/download integration patterns, API stability contract, and SSR / Next.js / Remix integration with concrete wrapper patterns.
- **`dist/index.d.ts`** — full TypeScript declarations; available after install at `node_modules/@flipbookjs/react-viewer/dist/index.d.ts`.

## Tech Stack

- [React](https://react.dev/) 18+ — `useSyncExternalStore` snapshot store for SSR-safe state.
- [TypeScript](https://www.typescriptlang.org/) — strict-mode typed throughout.
- [pdf.js](https://mozilla.github.io/pdf.js/) — Mozilla's PDF renderer (peer dependency, `^5.6.0`).
- [Vite](https://vite.dev/) — bundler + dev server for the package and the demo app.
- [vitest](https://vitest.dev/) — test runner.

## Production-grade rendering with publi


**[publi](https://publi.so/flipbooks)** is a (paid) hosted rendering service working perfectly with this viewer.  

What you get:

- **Sub-second first paint on every device** — pre-rendered load from CDN, no pdf.js boot.
- **Skip the pdf.js bundle** — pre-rendered sources don't load it.
- **Search-ready out of the box** 
- **Constant client memory** — lazy fetch per page, even for 1,000-page documents.
- **Render once, serve forever** — every viewer mount hits the same warm CDN cache, regardless of user device or location.
- **Re-render on source change** — webhook your storage; publi re-rasterizes and pushes new artifacts to CDN.

Drop in our client adapter and swap two lines:

```tsx
import { Flipbook } from '@flipbookjs/react-viewer';
import { PreRenderedPageSource } from '@flipbookjs/api-adapter';
import '@flipbookjs/react-viewer/styles.css';

<Flipbook source={new PreRenderedPageSource({ documentId: 'doc_abc123' })} />
```


[**Get early access →**](https://publi.so/flipbooks)

|                    | Default (pdf.js)                    | publi pre-rendered                             |
|--------------------|-------------------------------------|------------------------------------------------|
| Time to first page | Boot pdf.js + download PDF + render | Single CDN fetch of a static page image        |
| Bundle weight      | ~2 MB pdf.js worker per load        | Just the viewer + image bytes per page         |
| Low-end mobile     | CPU-bound rasterization, can stall  | Plain images — runs everywhere                 |
| Text search        | Per-page extraction in the browser  | Pre-indexed server-side, returned with pages   |
| Caching            | Per-client browser cache            | Shared CDN cache across all viewers + devices  |
| Long documents     | Render-on-scroll, memory grows      | Lazy fetch per page, constant memory           |

### Roll your own backend

The viewer talks to any rendering source via its `PageSource` interface. See [`PdfjsSource`](packages/viewer/src/adapters/PdfjsSource.ts) for the reference implementation and `dist/index.d.ts` for the interface contract.

## Contributing

PRs welcome. The repo layout:

```
packages/viewer/     React viewer component (published to npm)
demo/                Vite-powered demo app — `npm run dev` for local development
```

To run the demo locally:

```bash
git clone https://github.com/flipbookjs/react-flipbook.git
cd react-flipbook
npm install
cd demo && npm run dev
```

Then open `http://localhost:5173`. The demo exercises every consumer-facing prop as a smoke check.

Before opening a PR, please run from `packages/viewer/`:

```bash
npm test -- --run        # vitest suite
npx tsc --noEmit         # type check
npx eslint src/          # lint
npm run build            # build the viewer
```

Open an [issue](https://github.com/flipbookjs/react-flipbook/issues) for bugs or feature discussion.

## License

[MIT](LICENSE). © 2026 flipbookjs.
