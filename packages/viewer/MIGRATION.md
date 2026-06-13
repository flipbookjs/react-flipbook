# Migration Guide — `@flipbookjs/react-viewer` post-Step-6

> Audience: integration owners (CMS, custom apps, embeddable iframe consumers) upgrading from the pre-Step-6 viewer (page spreads only) to the post-Step-6 viewer (full UI chrome).
> Library version: `@flipbookjs/react-viewer@1.0.0`. Strict semver from here — see §10 for what's covered and what would trigger a `2.0.0`.
> Companion docs: `README.md` (entry-point overview, if added), `dist/index.d.ts` (full TypeScript types).

## 1. What changed at the library level

Step 6 added a complete UI chrome surface to the viewer:
- Public hook layer (`useFlipbook`, `useFlipbookSelector`, `useFlipbookActions`, `shallowEqual`).
- Toolbar parts sub-path (`@flipbookjs/react-viewer/toolbar-parts`).
- Built-in `<Toolbar>` with theme runtime + onThemeChange callback.
- Thumbnail panel + toggle button.
- Fullscreen action + button.
- Selection-mode (hand-pan) action + button.
- Print pipeline + button + error banner.
- Download action + button.

Pre-Step-6, the viewer rendered only the page spreads (`<Flipbook url="..." />`). CMS integrators built their own chrome around it. Post-Step-6, the viewer ships with a complete default UI; CMS integrators choose between (a) the built-in toolbar via `toolbar={true}`, (b) a custom toolbar composed from `toolbar-parts`, or (c) no toolbar via `toolbar={false}`.

## 1.5 Installation + peer dependencies

```bash
npm install @flipbookjs/react-viewer@1.0.0 pdfjs-dist react react-dom
```

The library declares three peer dependencies that consumers must install alongside the package. The library does NOT bundle them — consumers control the versions to avoid duplication across other PDF + React libraries in the same app.

| Peer | Version range | Why |
|------|---------------|-----|
| `pdfjs-dist` | `^5.6.0` | The viewer wraps pdf.js for page rendering. Consumers control the version to avoid duplicating pdf.js across multiple PDF libraries in the same app. |
| `react` | `>=18.0.0` | The viewer uses `useSyncExternalStore` (React 18 API) for the snapshot store. React 17 is not supported. |
| `react-dom` | `>=18.0.0` | Matches React's version constraint. |

**Install-tool behavior across versions:**

- **npm 7+** (released Oct 2020; widespread by 2026): peer deps are auto-installed if missing AND version-compatible with your other deps. npm emits warnings — not errors — on minor version conflicts. The explicit install command above is still recommended so the peers land in YOUR `package.json` (not just transitively in `node_modules/`).
- **npm 6 or earlier**: peer deps are NOT auto-installed; the explicit install command is required.
- **Strict-peer modes** (`npm install --strict-peer-deps`, pnpm default, npm 7+ with the flag): install FAILS if peer-dep versions conflict with your other deps. Pin compatible versions in your `package.json` first (e.g., `"react": "^18.2.0"`).

**pdf.js worker:** pdf.js requires a worker script for off-main-thread parsing. The library's `configurePdfWorker` helper (exported from the main entry) handles worker registration — call it once at app startup before the first `<Flipbook>` mounts. See the API reference in `dist/index.d.ts` for the signature.

## 2. New consumer-facing props

All new props on `<Flipbook>` are optional. Behaviors below assume defaults; pass the prop only to override.

### 2.1 Toolbar visibility + chrome

| Prop | Origin | Type | Default | Semantic |
|------|--------|------|---------|----------|
| `toolbar` | 6C | `boolean \| ReactNode` | `true` | `true` renders the built-in `<Toolbar>`; `false` hides chrome entirely; a `ReactNode` (e.g., `<CustomToolbar />`) renders the consumer's composition. |
| `compact` | 6C | `boolean` | `false` | Compacts the built-in toolbar's spacing; useful for narrow viewports or sidecar layouts. |
| `title` | 6C | `string \| undefined` | `undefined` | Display-only title shown in the toolbar (NOT the filename — see `documentName`). |
| `showZoom` | 6C | `boolean \| undefined` | `true` | Hides/shows the zoom-out / zoom-readout / zoom-in group. |
| `showNavigation` | 6C | `boolean \| undefined` | `true` | Hides/shows the prev/next/pageReadout group. |
| `showThumbnails` | 6D | `boolean \| undefined` | `true` | Hides/shows the thumbnails-toggle button. |
| `showFullScreen` | 6E | `boolean \| undefined` | `slice.canFullScreen` | Hides/shows the fullscreen button. Default tracks browser Fullscreen API availability — `false` in iframes without `allowfullscreen` (see §4.2). |
| `showSelectionMode` | 6E2 | `boolean \| undefined` | `true` | Hides/shows the selection/hand-pan toggle. |
| `showPrint` | 6F1 | `boolean \| undefined` | `true` | Hides/shows the print button. |
| `showDownload` | 6F2 | `boolean \| undefined` | `slice.canDownload` | Hides/shows the download button. Default tracks `source.getSourceUrl?()` — `false` for non-URL sources (e.g., `Uint8Array`). **Default flipped in 6F2** (see §3.1). |

### 2.2 Theme

| Prop | Origin | Type | Default | Semantic |
|------|--------|------|---------|----------|
| `initialTheme` | 6C | `'light' \| 'dark' \| undefined` | `'light'` | Initial theme applied on mount. Subsequent toggles via `actions.setTheme` or the theme-toggle button. |
| `onThemeChange` | 6C | `(theme: 'light' \| 'dark') => void \| undefined` | `undefined` | Fires after each theme change. Consumer persistence hook — sync to localStorage, sync to app's theme store, etc. |

### 2.3 Print

| Prop | Origin | Type | Default | Semantic |
|------|--------|------|---------|----------|
| `printMaxPages` | 6F1 | `number \| undefined` | `50` | Hard ceiling — print aborts with `PrintLimitExceededError` if the doc exceeds. Memory-discipline guard. |
| `printScale` | 6F1 | `number \| undefined` | `1.5` | PDF render scale for the print sheet. Higher = better resolution + more memory. |
| `printErrorDismissMs` | 6F1 | `number \| undefined` | `6000` | Auto-dismiss timeout for the inline error banner. `0` disables auto-dismiss. |
| `onPrintStart` | 6F1 | `(info: PrintInfo) => void \| undefined` | `undefined` | Fires when print pipeline begins (analytics hook). |
| `onPrintComplete` | 6F1 | `(info: PrintInfo) => void \| undefined` | `undefined` | Fires after print preview launches successfully. |
| `onPrintError` | 6F1 | `(err: Error, info: PrintInfo) => void \| undefined` | `undefined` | Fires when print fails (limit exceeded, render error, etc.). |
| `onPrintAbort` | 6F1 | `(info: PrintInfo) => void \| undefined` | `undefined` | Fires when consumer or user cancels print mid-flight. |

### 2.4 Download

| Prop | Origin | Type | Default | Semantic |
|------|--------|------|---------|----------|
| `documentName` | 6F2 | `string \| undefined` | `undefined` | Semantic filename for downloads. If absent, the library derives from `source.getSourceUrl?()` basename (URL-decoded). The library appends `.pdf` if missing and sanitizes OS-illegal chars. |

### 2.5 `PageSource` interface additions

The `PageSource` interface gains one optional method:

```ts
interface PageSource {
  // existing methods unchanged
  getSourceUrl?(): string | undefined;  // 6F2 — opt-in to URL-based download
}
```

Implementations that opt in to URL-based download return a string (the source URL); opt-out implementations omit the method entirely. The built-in `PdfjsSource` implements it: returns the URL for `string`/`URL` sources, `undefined` for `Uint8Array` sources.

### 2.6 Initial interaction mode

Added in `1.0.0`.

| Prop | Origin | Type | Default | Semantic |
|------|--------|------|---------|----------|
| `initialInteractionMode` | 1.0.0 | `'select' \| 'pan' \| undefined` | `'select'` | Initial interaction mode applied on mount. `'pan'` for hand-drag panning, `'select'` for text selection. Uncontrolled — to change at runtime, dispatch `actions.setInteractionMode()`. Mirrors the `initialTheme` pattern (read once in the lazy `useReducer` initializer; post-mount prop changes are ignored). |

### 2.7 Thumbnails

Added in `1.0.0`.

| Prop | Origin | Type | Default | Semantic |
|------|--------|------|---------|----------|
| `thumbnailSize` | 1.0.0 | `'small' \| 'default' \| 'large' \| number \| undefined` | `undefined` → `pageWidth × 0.2` per page (0.1.0-alpha.1 behavior, preserved for backward compatibility) | Bounding-box width of built-in thumbnail items. When **omitted**, the panel preserves the 0.1.0-alpha.1 sizing (per-page `pageWidth × 0.2`) — un-opted consumers see no visual change. When **supplied**, tokens map to 360 / 480 / 720 px; an explicit number is the literal pixel width for responsive layouts. Height per item derives from each page's actual aspect ratio. Invalid numeric input (`NaN` / `Infinity` / ≤0) falls back to `'default'` (480 px) with a once-per-bad-value dev-warn; values above 2048 px clamp to 2048 with a dev-warn. The canvas backing-store resolution scales with the displayed CSS size, so larger tokens stay crisp on Retina. |

## 3. Default-flip release notes (LOAD-BEARING for CMS migration)

### 3.1 Download button visibility default flip (Step 6F2)
Pre-6F2, `helpers.canDownload` was hardcoded `false`, so `resolveToolbarVisibility`'s default rule `props.showDownload ?? slice.canDownload` resolved to `false` — the download button was hidden by default. Post-6F2, `canDownload` is derived from `source.getSourceUrl?()`, so for URL-backed sources the default flips to `true` and the button shows by default.

**CMS-side action:** consumers who relied on the button being hidden (without passing `showDownload`) must now pass `showDownload={false}` explicitly.

### 3.2 Other consumer-visible defaults
- `showFullScreen` defaults to `slice.canFullScreen` (true in browsers with Fullscreen API). Iframe consumers must add `allowfullscreen` to their `<iframe>` wrapper.
- `showThumbnails`, `showPrint`, `showSelectionMode`, `showZoom`, `showNavigation` all default to `true`. Consumers can hide via `={false}`.

## 4. Iframe embedding requirements

The viewer relies on several browser capabilities that iframe embeddings can disable. Three distinct mechanisms — sandbox tokens, the legacy `allowfullscreen` attribute, and the modern Permissions Policy — each control different capabilities.

### 4.1 Sandbox tokens (control script-execution capabilities)

When the iframe uses `<iframe sandbox="...">`, the following tokens must be included:
- `allow-same-origin` (required for the viewer's React runtime).
- `allow-scripts` (required for any React app).
- `allow-downloads` — required for the download button to fire `<a>.click()` (Step 6F2 KL12).
- `allow-popups` — required for the cross-origin download fallback (new tab) to open.
- `allow-modals` — required for the print preview window.

Sandbox is opt-in: an iframe WITHOUT the `sandbox` attribute has all capabilities by default. Iframes WITH `sandbox` strip everything except what the tokens re-grant. Missing tokens cause silent failures (no console error from the library); the browser may emit a sandbox-violation warning.

### 4.2 Fullscreen (NOT a sandbox token)

Fullscreen permission is controlled by the iframe's `allowfullscreen` attribute (legacy, still widely supported) AND/OR the Permissions Policy `allow="fullscreen"` attribute (modern, what newer browsers prefer):

```html
<!-- Legacy form, supported by all browsers: -->
<iframe src="..." allowfullscreen></iframe>

<!-- Modern form (Permissions Policy), preferred for new integrations: -->
<iframe src="..." allow="fullscreen"></iframe>

<!-- Both together — safe for cross-browser compatibility: -->
<iframe src="..." allowfullscreen allow="fullscreen"></iframe>
```

Without one of these, the browser's Fullscreen API rejects the `requestFullscreen()` call. The viewer detects this via `document.fullscreenEnabled` and hides the fullscreen button (consumer-visible default: `slice.canFullScreen` is `false`, so `props.showFullScreen ?? slice.canFullScreen` evaluates to `false` and the button doesn't render). This is graceful — no broken UI — but consumers wanting a working fullscreen button MUST add `allowfullscreen` (or `allow="fullscreen"`) to their iframe.

**Note:** `allow-fullscreen` (with hyphen) is NOT a valid sandbox token. Some online docs conflate sandbox tokens with the `allow` attribute; only the values listed in §4.1 are sandbox tokens.

## 5. URL encoding gotcha

Pass URLs with single percent-encoding for spaces (`%20`), not double (`%2520`). The Step 6F2 download action uses `decodeURIComponent` to clean up the URL basename for the filename, but the `<a href>` itself uses the URL verbatim — double-encoded URLs produce 404 from the server and `LDEO%2520Annual...` in the address bar.

## 6. Toolbar-parts composition path

For consumers who want full control over the toolbar layout (reorder parts, interleave custom buttons, omit parts, add brand chrome), the `toolbar-parts` sub-path exports the primitives. The pattern: import the parts, wrap them in your own layout component, pass that component as the `toolbar` prop on `<Flipbook>`.

### 6.1 Available primitives

The sub-path exports 12 part components, 1 hook, 1 context, 1 LABELS constant, the `<ToolbarShell>` keyboard-roving wrapper, and re-exports of `<Toolbar>` + `<ThumbnailPanel>` for single-import composition:

```ts
import {
  // Layout primitives
  ToolbarShell,           // roving-tabindex + keyboard nav container
  ToolbarShellContext,    // raw context (advanced — usually unneeded)
  useToolbarPart,         // hook for custom parts to register with ToolbarShell
  LABELS,                 // default i18n strings (override per-part via props)

  // Buttons (12)
  PrevButton, NextButton,
  ZoomInButton, ZoomOutButton,
  FullScreenButton,
  PrintButton, DownloadButton,
  SelectionModeButton, ThemeToggleButton, ThumbnailsToggleButton,
  PageReadout, ZoomReadout,

  // Re-exports (for single-import compositions)
  Toolbar, ThumbnailPanel,
} from '@flipbookjs/react-viewer/toolbar-parts';
```

### 6.2 Minimal composition example

```tsx
import { Flipbook } from '@flipbookjs/react-viewer';
import {
  ToolbarShell,
  PrevButton, NextButton, PageReadout,
  ZoomOutButton, ZoomReadout, ZoomInButton,
  PrintButton, DownloadButton, FullScreenButton,
} from '@flipbookjs/react-viewer/toolbar-parts';
import '@flipbookjs/react-viewer/styles.css';

function CustomToolbar() {
  return (
    <ToolbarShell className="my-toolbar">
      <div className="my-toolbar-left">
        <PrevButton />
        <NextButton />
        <PageReadout />
      </div>
      <div className="my-toolbar-center">
        <ZoomOutButton />
        <ZoomReadout />
        <ZoomInButton />
      </div>
      <div className="my-toolbar-right">
        <PrintButton />
        <DownloadButton />
        <FullScreenButton />
      </div>
    </ToolbarShell>
  );
}

function App() {
  return (
    <Flipbook
      url="/my-document.pdf"
      documentName="My Document"
      toolbar={{ top: <CustomToolbar /> }}
    />
  );
}
```

The single-`ReactNode` form (`toolbar={<CustomToolbar />}`) also works and renders in the **top** slot from `1.0.0` onward (changed from the bottom slot in the `0.1.0-alpha.1` pre-release). Prefer the explicit slot form above to make the position obvious at the call site and to be resilient to future default changes. To target the bottom slot specifically, use `toolbar={{ bottom: <CustomToolbar /> }}`.

### 6.3 Custom-button composition (calling actions directly)

Custom buttons that aren't part components use the public hooks from the main entry:

```tsx
import { Flipbook, useFlipbookActions, useFlipbookSelector } from '@flipbookjs/react-viewer';
import {
  ToolbarShell, PrevButton, NextButton, PageReadout,
} from '@flipbookjs/react-viewer/toolbar-parts';

function GoToCoverButton() {
  const { goToFirst } = useFlipbookActions();
  // useFlipbookSelector receives a FlipbookSnapshot; state lives at s.state.
  const pageNumber = useFlipbookSelector((s) => s.state.pageNumber);
  return (
    <button onClick={goToFirst} disabled={pageNumber === 1}>
      Cover
    </button>
  );
}

function CustomToolbar() {
  return (
    <ToolbarShell>
      <GoToCoverButton />
      <PrevButton />
      <NextButton />
      <PageReadout />
    </ToolbarShell>
  );
}
```

The `useFlipbookActions` + `useFlipbookSelector` hooks resolve through React context provided by `<Flipbook>` — they only work when the consumer's custom toolbar is nested inside `<Flipbook toolbar={...}>`, NOT when rendered standalone.

### 6.4 Notes

- **Roving tabindex:** `<ToolbarShell>` implements arrow-key navigation between parts via the roving-tabindex pattern. Wrapping your custom buttons in a child of `<ToolbarShell>` opts them in via `useToolbarPart`.
- **Styling:** the built-in part components carry no inline styles — they pick up `.fbjs-*` classes from `styles.css`. Compose with your own className wrappers for layout.
- **LABELS override:** each part button accepts the standard `aria-label` HTML attribute, defaulting to `LABELS.<key>` (see `LABELS` in the sub-path for the full key list). Per-instance override: `<PrevButton aria-label="Vorige pagina" />`. Global i18n (replacing all labels at once) is **deferred to a future `1.x` minor release** — a `ToolbarLabelsContext` is planned but not shipped in `1.0.0`. The exported `LABELS` constant is **read-only** in `1.0.0` (consumers can read it for runtime introspection but not mutate it). Readouts (`PageReadout`, `ZoomReadout`) generate visible text via template functions that aren't overridable in `1.0.0` without forking the part via the sub-path import.

## 7. Theme runtime + onThemeChange persistence

### 7.1 onThemeChange + initialTheme round-trip

Consumers can sync the viewer's theme to their app's theme store via `onThemeChange`. Pattern: lift the theme into a React state, persist to localStorage or your app's theme context, pass back via `initialTheme`.

### 7.2 Driving theme from external state

For CMSes or apps that own theme as global state (Redux / Zustand / Jotai / React Context store), sync external theme INTO the viewer via a small `<ThemeSyncer>` component mounted as a `<Flipbook>` child. The child runs INSIDE provider context, so `useFlipbookActions()` resolves (it throws outside).

```tsx
import { Flipbook, useFlipbookActions } from '@flipbookjs/react-viewer';
import { useMyAppThemeStore } from './my-app-state';
import { useEffect } from 'react';

// Effect host — no UI, just keeps the viewer's theme synced to external state.
// Must be mounted INSIDE <Flipbook> via the `children` prop so
// useFlipbookActions can resolve provider context.
function ThemeSyncer({ theme }: { theme: 'light' | 'dark' }) {
  const actions = useFlipbookActions();
  useEffect(() => { actions.setTheme(theme); }, [theme, actions]);
  return null;
}

function FlipbookWithExternalTheme({ url }: { url: string }) {
  const theme = useMyAppThemeStore((s) => s.theme);

  return (
    <Flipbook
      url={url}
      initialTheme={theme}
      // ^ Seeds the value on FIRST RENDER only — eliminates the flash from
      //   default to consumer-value at mount. After mount, the `useEffect`
      //   inside <ThemeSyncer> propagates subsequent external-state changes.
      onThemeChange={(next) => useMyAppThemeStore.getState().setTheme(next)}
    >
      <ThemeSyncer theme={theme} />
    </Flipbook>
  );
}
```

How this works:

- `<ThemeSyncer>` mounts inside provider context (via the `children` prop), so `useFlipbookActions()` resolves successfully. A sibling/parent of `<Flipbook>` would crash because the provider context isn't established outside.
- `initialTheme={theme}` seeds the reducer at mount — no flash from `'light'` to the consumer's actual theme value.
- The `useEffect` inside `<ThemeSyncer>` runs on every external-state change → dispatches `setTheme`. **Note:** introduces a 1-frame render lag (external change → effect runs post-commit → dispatch → re-render). For theme this is invisible in practice; for continuous-slider zoom (see §9.2) it can be perceptible.
- `onThemeChange` flows toolbar-driven theme changes BACK to the external store when the consumer uses the built-in theme-toggle.
- `actions.setTheme` has stable identity (per the 6A action-stability contract), so the effect's `[theme, actions]` dep array stays quiet between unrelated re-renders.

**React StrictMode note.** Under React 18+ StrictMode, every effect mounts twice in development (mount → cleanup → mount). `<ThemeSyncer>`'s effect dispatches `actions.setTheme(theme)` twice on mount in dev; both calls dispatch the SAME value, so `flipbookReducer.ts` returns the same state object via the no-op early-return at `SET_THEME` (`if (state.theme === action.value) return state;`) — no cascade, no infinite loop. The deps (`[theme, actions]`) don't change when `setTheme` is dispatched: `actions` is stable per the 6A contract, and `theme` is owned by the EXTERNAL store, not by the viewer. Same logic applies to `<ScaleSyncer>` in §9.2.

## 8. Print integration callbacks

`onPrintStart` / `onPrintComplete` / `onPrintError` / `onPrintAbort` give consumers analytics + user-facing notification hooks. The print pipeline's per-page memory discipline + hard `printMaxPages` ceiling are documented in Step 6F1's KLs (see archived).

## 9. Download integration

### 9.1 documentName + filename sanitization

`documentName` is the semantic filename prop (distinct from display-only `title`). The library applies `sanitizeFilename` (strips OS-illegal chars, caps at 200 chars, ensures single `.pdf` extension). Consumer-side analytics for download clicks go via `<DownloadButton onClick={...} />`.

### 9.2 Driving zoom from external state

For apps that own zoom level as external state (e.g., persisted user preference, analytics-driven zoom suggestion), sync via a `<ScaleSyncer>` child — same pattern as §7.2's `<ThemeSyncer>`:

```tsx
import { Flipbook, useFlipbookActions } from '@flipbookjs/react-viewer';
import type { DefaultScale } from '@flipbookjs/react-viewer';
import { useMyAppZoomStore } from './my-app-state';
import { useEffect } from 'react';

function ScaleSyncer({ scale }: { scale: DefaultScale }) {
  const actions = useFlipbookActions();
  useEffect(() => { actions.setZoom(scale); }, [scale, actions]);
  return null;
}

function FlipbookWithExternalZoom({ url }: { url: string }) {
  const scale = useMyAppZoomStore((s) => s.scale);
  return (
    <Flipbook url={url} defaultScale={scale}>
      <ScaleSyncer scale={scale} />
    </Flipbook>
  );
}
```

Same render-lag trade-off as §7.2 (1 frame between external change and viewer re-render). Typically invisible for stepped zoom (preset buttons); potentially perceptible during continuous-slider drag, where the consumer is dragging at >60Hz and feels each frame. If that becomes a real consumer complaint, the fix is a separate piece of work (snapshot-reads-from-prop-directly refactor) — not bundled into this batch.

`actions.setZoom` accepts the same `DefaultScale` union as `defaultScale` (numeric scale factor, fit-mode strings, or `SpecialZoomLevel` enum members).

## 10. API stability

`1.0.0` commits the library to strict semver. Consumers can safely use a caret range (`"@flipbookjs/react-viewer": "^1.0.0"`) and expect:

- **PATCH releases (`1.0.x`)** — bug fixes and dev-warn removals only. No new public surface.
- **MINOR releases (`1.x.0`)** — additive only. New props on `<Flipbook>`, new optional `PageSource` methods, new `FlipbookHookActions` actions, new `FlipbookHookState` fields, new CSS custom properties, new components in the `toolbar-parts` sub-path. Existing surface unchanged.
- **MAJOR releases (`2.0.0`)** — only path for breaking changes (see "What requires a major bump" below). Will ship with a migration guide.

### What's covered by `1.x` semver (will not break without a `2.0.0`)

- **Every prop on `<Flipbook>`** documented in §2 — names, types, defaults, and the discriminated-union shape of `FlipbookProps`.
- **Every required and optional method** on the `PageSource` interface, INCLUDING the SHAPE (signature + return type) of the optional methods (`getSourceUrl?()`, `getTextContent?()`, `getLinks?()`, `getOutline?()`).
- **The full public hook surface:** `useFlipbook`, `useFlipbookSelector`, `useFlipbookActions`, `shallowEqual` — including signatures, return shapes, and SSR-safety contracts.
- **Every action on `FlipbookHookActions`** documented as of `1.0.0` — names, signatures, dispatch semantics.
- **Every field on `FlipbookHookState`** documented as of `1.0.0` — names and types. The discriminated union over `status: 'loading' | 'ready' | 'error'` is stable.
- **All `.fbjs-*` CSS class names** in `styles.css`.
- **All `--fbjs-*` CSS custom-property NAMES.** Default VALUES are documented but may shift in MINOR releases when a value tweak is non-breaking for the documented contract (e.g., a color refinement); MAJOR-breaking value changes would go to `2.0.0`.
- **Import paths:** `'@flipbookjs/react-viewer'`, `'@flipbookjs/react-viewer/toolbar-parts'`, `'@flipbookjs/react-viewer/styles.css'`.
- **`PageSource` adapter exports:** `PdfjsSource`, `PdfjsSourceOptions`, `configurePdfWorker`.
- **Component identity:** `<Flipbook>` as the primary integration point; `<Toolbar>` and the toolbar parts as composable building blocks.

### What MAY evolve additively across `1.x` minor releases

- New optional `PageSource` methods (e.g., a `getSearchIndex?()` for full-text search).
- New `FlipbookHookActions` actions (e.g., a `setRotation()` for page rotation support).
- New `FlipbookHookState` fields (e.g., a `rotation` field on the same state object).
- New props on `<Flipbook>` — all additive optional.
- New `toolbar-parts` sub-path exports — new button components, readouts, helpers.
- New CSS custom properties for new features.

Additive evolution does NOT require a major-version bump and does NOT break existing consumers.

### What requires a `2.0.0`

- Removing or renaming any existing prop, hook export, action, state field, or CSS class.
- Changing the type or signature of any existing public surface.
- Flipping the DEFAULT VALUE of any existing prop in a consumer-visible way.
- Removing a `PageSource` method from the optional set in a way that makes existing implementations type-incompatible.
- Any change that requires an existing consumer to modify code to keep working.

The `2.0.0` migration plan will ship with a separate MIGRATION-v2.md guide listing every breaking change, the equivalent v1 → v2 replacement, and any deprecation aid (e.g., codemods or runtime warnings landed in late `1.x` releases).

### What's deferred to a future MINOR release (not breaking)

See §11 for the forward-compatibility plan: text content extraction (v0.2 work, now planned for a `1.x` minor), link annotations, document outline, i18n via `ToolbarLabelsContext`. All additive.

## 11. Forward-compatibility hooks

- `documentName` prop today; v0.2 may introduce a unifying `name?: string` prop that defaults BOTH `title` and `documentName` (see Step 6F2 D7).
- `getSourceUrl?()` is optional on `PageSource`; future v0.2 work (selection/search/outline) extends the interface additively.
- The toolbar-parts sub-path can absorb new parts additively without breaking existing compositions.

## 12. Migration checklist for CMS integrators

For each integration, walk this list before deploying the upgraded viewer:

- [ ] **Install peer dependencies:** `pdfjs-dist@^5.6.0`, `react@>=18.0.0`, `react-dom@>=18.0.0` — see §1.5 for the version matrix and install-tool-version behavior (npm 6 vs 7+ vs strict-peer modes).
- [ ] **Pin the version:** `npm install @flipbookjs/react-viewer@^1.0.0` (caret range; minor + patch updates are additive only — see §10 API stability).
- [ ] **Audit `<Flipbook>` prop usage in the CMS integration code.** Cross-reference against §2's tables. Most props are additive; the load-bearing migration is §3.1.
- [ ] **§3.1 — Download default:** if the integration relied on the download button being HIDDEN (without passing `showDownload`), add `showDownload={false}` explicitly. Otherwise the button will start showing post-upgrade for URL-backed sources.
- [ ] **§4.1 — Iframe sandbox tokens:** if the viewer renders inside `<iframe sandbox="...">`, add `allow-downloads`, `allow-popups`, `allow-modals` to the token list. Without these, download + print silently fail.
- [ ] **§4.2 — Iframe fullscreen:** add `allowfullscreen` (legacy) or `allow="fullscreen"` (Permissions Policy) to the `<iframe>` wrapper if you want the fullscreen button visible.
- [ ] **§5 — URL encoding:** verify URLs passed via the `url` prop use single percent-encoding (`%20`), not double (`%2520`).
- [ ] **§7 — Theme persistence (optional):** if the CMS has a global theme store, wire `onThemeChange` to it and pass back via `initialTheme` on the next mount.
- [ ] **§8 — Print integration (optional):** wire `onPrintStart` / `onPrintComplete` / `onPrintError` / `onPrintAbort` to analytics + user-facing notifications if applicable.
- [ ] **§9 — Download filename:** pass `documentName` if the source URL's basename isn't a good filename (e.g., URLs like `/api/pdf?id=123` — the library falls back to `pdf` as the basename, which is rarely what users want).
- [ ] **Smoke test in target environment:** open the integrated viewer in the CMS, click each toolbar button, verify each behavior (prev/next, zoom, fullscreen, print, download, selection mode, theme toggle, thumbnails). The viewer's default UI exercises every action — if all buttons work end-to-end, the integration is good.
- [ ] **(Composition-path consumers only) Audit `toolbar-parts` imports:** sub-path imports are SEMVER-stable across the `1.x` line (per §10). If you upgraded an existing composition, the only forward-looking risk is new parts being added — your composition still works; new parts just aren't picked up automatically.

## 13. SSR / Next.js / Remix integration

`<Flipbook>` is a **client-only** component. It depends on `<canvas>` for PDF rendering and the browser's File / Fullscreen / Window APIs — server rendering is not possible. Consumers integrating into framework-rendered apps must isolate the viewer to a client boundary.

The library's `Flipbook.tsx` source includes a `'use client';` directive, but consumers should NOT rely on it propagating through the built bundle. Add the boundary yourself.

### 13.1 Next.js App Router

Wrap your viewer route (or a leaf component containing the viewer) in a client boundary:

```tsx
// app/reader/page.tsx
'use client';
import { Flipbook } from '@flipbookjs/react-viewer';
import '@flipbookjs/react-viewer/styles.css';

export default function ReaderPage() {
  return <Flipbook url="/document.pdf" documentName="My Document" />;
}
```

If the parent route needs to stay server-rendered (e.g., for metadata + SEO), put `<Flipbook>` in a child component marked `'use client';` and import it from the server component.

### 13.2 Next.js Pages Router / Remix / Gatsby

Use a dynamic import that disables SSR:

```tsx
import dynamic from 'next/dynamic';

const Flipbook = dynamic(
  () => import('@flipbookjs/react-viewer').then((m) => m.Flipbook),
  { ssr: false, loading: () => <p>Loading viewer…</p> },
);

export default function ReaderPage() {
  return <Flipbook url="/document.pdf" />;
}
```

Remix's equivalent: use `<ClientOnly>` from `remix-utils` (or a hand-rolled `useEffect`-mounted wrapper) — same effect, isolate the viewer to post-hydration.

Gatsby: gate with `typeof window !== 'undefined'` or use `loadable-components` with `{ ssr: false }`.

### 13.3 Hook surface in SSR

The hooks (`useFlipbook`, `useFlipbookSelector`, `useFlipbookActions`) are **SSR-safe** — during the server render they return frozen sentinel snapshots via the library's internal `SSR_HOOK` / `SSR_SNAPSHOT` machinery:

- `status: 'loading'`, `source: null`, `error: null`
- `state` = `SSR_STATE` (placeholder fields: `pageNumber: 1`, `totalPages: 0`, etc.)
- `actions` = no-op object (each action method is a stable-identity stub)
- `helpers` = `{ canDownload: false, canFullScreen: false, pageToSpreadIndex: () => -1 }`

Reads during SSR are stable (no hydration mismatch). After hydration, the hooks re-bind to the live store and the next render reflects the real state. Consumer code that branches on `status` will see `'loading'` server-side and the real status client-side — equivalent to any other client-bound store.

### 13.4 Static export (Next.js `output: 'export'`, Astro `prerender: true`, etc.)

Same constraints as SSR — wrap in a client boundary or dynamic import. The canvas-bearing components run only post-hydration; the static HTML output renders the `loading: () => …` fallback (or nothing) until the bundle loads.

### 13.5 Stylesheet import in SSR

`@flipbookjs/react-viewer/styles.css` is a plain CSS import — safe to import from server components. Frameworks that scope CSS imports to client components (some Vite-based setups) may require importing it from the same boundary as `<Flipbook>`; check your framework's CSS-handling docs if the styles don't apply.
