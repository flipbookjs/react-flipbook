# Migration Guide — `@flipbookjs/react-viewer@3.0.0`

> Audience: integration owners upgrading from `2.x` to `3.0.0`.
> Companion: `MIGRATION-v2.md` (the 1.x → 2.0 guide) and `MIGRATION.md` (the 1.0.0 → post-1.0.0 guide). Both still apply for every other prop, hook, action, state field, and CSS class.

## 1. What changed

The `ZoomReadout` toolbar part is **removed**, replaced by `ZoomMenu` —
an interactive dropdown that exposes the zoom presets directly instead
of relying on the adjacent zoom-in / zoom-out buttons.

- **`ZoomReadout`** was a passive `<span role="status">` displaying the
  current zoom percent.
- **`ZoomMenu`** renders the same percent as the dropdown's trigger
  button. Opening the menu reveals 11 entries: `Actual size`, `Page
  fit`, `Page width`, a separator, and eight preset percentages (50%,
  75%, 100%, 125%, 150%, 200%, 300%, 400%). Selecting an entry
  dispatches the existing `setZoom` / `fitPage` / `fitWidth` actions.

The change ships alongside `ToolbarMenu`, a new generic provider-free
menu primitive. Both `ZoomMenu` and `ToolbarMenu` are exported from
`@flipbookjs/react-viewer/toolbar-parts`.

## 2. Why

The 2.x zoom controls required three separate parts to operate (two
buttons + a passive readout) and offered no direct preset entry. Users
who wanted exactly `200%` had to repeatedly click `+` and read the
readout to confirm. A dropdown trigger consolidates the surface — the
readout becomes interactive without losing its display role — and adds
discoverable presets without consuming additional toolbar slots.

The shipped `ToolbarMenu` primitive establishes the WAI-ARIA menubutton
foundation a future theme picker, view-mode selector, and settings menu
will consume. It is provider-free; domain consumers (`ZoomMenu`,
future siblings) supply the items + state binding.

## 3. Default `<Toolbar>` — no consumer action needed

If you render `<Flipbook>` or `<Toolbar>` (the built-in wrapper), the
swap is automatic. The bottom-bar zoom group renders `<ZoomMenu />`
between the existing `<ZoomOutButton />` and `<ZoomInButton />` parts.

## 4. Custom toolbar — replace `<ZoomReadout />` with `<ZoomMenu />`

If you built a custom toolbar by composing parts from the sub-path
export:

```diff
- import { ZoomReadout, ZoomInButton, ZoomOutButton, ToolbarShell }
-   from '@flipbookjs/react-viewer/toolbar-parts';
+ import { ZoomMenu, ZoomInButton, ZoomOutButton, ToolbarShell }
+   from '@flipbookjs/react-viewer/toolbar-parts';

  <ToolbarShell>
    <ZoomOutButton />
-   <ZoomReadout />
+   <ZoomMenu />
    <ZoomInButton />
  </ToolbarShell>
```

`ZoomMenu` accepts the same `className` and `data-testid` conventions
as the rest of the toolbar parts. Its `data-testid` prop sets the root
ID; sub-element testids derive from it (see §6 below).

## 5. Removed exports

| 2.x export | 3.0 replacement |
|---|---|
| `ZoomReadout` (component) | `ZoomMenu` |
| `LABELS.zoomReadout(percent)` | `LABELS.zoomMenuTriggerLabel(percent \| null)` (now also accepts `null` for the loading state) |
| `LABELS.zoomReadoutLoading` | merged into `LABELS.zoomMenuTriggerLabel(null)` |

`LABELS` is exported from `@flipbookjs/react-viewer/toolbar-parts`.

## 6. Test selector migration

`ZoomReadout` exposed `data-testid="fbjs-zoom-readout"`. The replacement
surface is structurally different — a trigger button + a popover + a
hidden live region.

| 2.x selector | 3.0 equivalent |
|---|---|
| `[data-testid="fbjs-zoom-readout"]` (root span) | `[data-testid="fbjs-zoom-menu-trigger"]` (interactive button — same visible percent text) |
| (none — readout was the announcement source via its own `aria-label`) | `[data-testid="fbjs-zoom-menu-readout-live"]` (visually hidden live region — same verbose announcement template) |

Visible text content of the trigger is unchanged from `ZoomReadout`'s
content — `Math.round(scale * 100) + '%'` when ready, em-dash (`—`)
otherwise. Tests that asserted on the text content continue to pass
once the selector is updated; tests that asserted on the element being
a `<span>` need updating to `<button>`.

If you pass a custom root `data-testid` (e.g.,
`<ZoomMenu data-testid="my-zoom" />`), all sub-element testids derive
from it: `my-zoom-trigger`, `my-zoom-popover`,
`my-zoom-item-actualSize`, `my-zoom-readout-live`, etc.

## 7. CSS

`ZoomMenu` reuses the existing `--fbjs-toolbar-*` and `--fbjs-border`
custom properties. No new theme tokens are required to display the
menu correctly in light or dark themes.

The popover shadow uses the existing `--fbjs-popover-shadow` token
(unchanged). The popover background, border, hover background, and
separator all resolve through `--fbjs-toolbar-bg`, `--fbjs-toolbar-fg`,
and `--fbjs-border` — values your `[data-theme='light']` /
`[data-theme='dark']` overrides already supply if you customized them.

## 8. Codemod

Not provided. The rename is mechanical; a project-wide find-and-replace
covers >99 % of cases.

```bash
# Import statements
sed -i '' "s/import { ZoomReadout }/import { ZoomMenu }/g" src/**/*.tsx
sed -i '' "s/ZoomReadout,/ZoomMenu,/g" src/**/*.tsx
sed -i '' "s/, ZoomReadout/, ZoomMenu/g" src/**/*.tsx

# JSX usage
sed -i '' "s|<ZoomReadout />|<ZoomMenu />|g" src/**/*.tsx
sed -i '' "s|<ZoomReadout />|<ZoomMenu />|g" src/**/*.tsx

# Test selectors
sed -i '' 's/data-testid="fbjs-zoom-readout"/data-testid="fbjs-zoom-menu-trigger"/g' src/**/*.{ts,tsx}

# Label references
sed -i '' "s/LABELS.zoomReadout(/LABELS.zoomMenuTriggerLabel(/g" src/**/*.{ts,tsx}
sed -i '' "s/LABELS.zoomReadoutLoading/LABELS.zoomMenuTriggerLabel(null)/g" src/**/*.{ts,tsx}
```

Audit before committing — `tsc` will flag any reference the rename
missed (the removed exports are no longer in the public-API types).

## 9. Version pin

```bash
npm install @flipbookjs/react-viewer@^3.0.0
```

The stability surface in `MIGRATION.md` §10 otherwise carries forward
unchanged into 3.x for every other prop, hook, action, state field, and
CSS class. `ZoomReadout` is the only breaking surface change in 3.0.
