# Migration Guide — `@flipbookjs/react-viewer@2.0.0`

> Audience: integration owners upgrading from `1.x` to `2.0.0`.
> Companion: `MIGRATION.md` (the 1.0.0 → post-1.0.0 guide; still applies for every other prop, hook, action, state field, and CSS class).

## 1. What changed

The 1.x `thumbnailSize` prop is **removed**, replaced by a discriminated
union of two purpose-built props with one clear semantic each:

- **`<Flipbook>` surface** — namespaced names (the namespace matters
  alongside many other Flipbook props):
  - `thumbnailDensity?: 'compact' | 'comfortable' | 'spacious'`
    (default `'comfortable'`)
  - `thumbnailWidth?: number` (absolute pixel width; clamped to [80, 2048])
- **`<ThumbnailPanel>` composable surface** — unprefixed names (the
  component name already provides the context):
  - `density?: 'compact' | 'comfortable' | 'spacious'` (default `'comfortable'`)
  - `width?: number` (clamped to [80, 2048])

Both surfaces share the same resolution semantics — the prop-name
difference is API-surface-only. A TypeScript discriminated union
prevents callers from supplying BOTH at the type level on either
surface. A JS-side bypass (untyped caller or `as any` cast) is caught
at runtime by a once-per-process dev-warn at the prop boundary; when
both somehow arrive, the explicit width wins.

## 2. Why

1.x absolute-pixel semantics don't adapt across embed contexts. A 360 px
thumbnail looks reasonable on a 1920 px desktop, cramped in a 600 px
iframe, absurd on a 400 px phone. Density tokens deliver responsive
behavior: `'compact'` always means many small thumbs, `'spacious'`
always means few large thumbs, because the math is relative to the
panel's container width (with per-page width preservation in
mixed-orientation documents).

The numeric escape hatch (`thumbnailWidth` / `width`) remains for
consumers needing an exact pixel value — design-system pinning,
print-preview parity, etc. It clamps to the safe range and silently
floors to 80 px (WCAG 2.5.5 touch-target advisory).

## 3. `<Flipbook>` migration table

| 1.x usage | 2.0 replacement | Notes |
|---|---|---|
| `thumbnailSize="small"` (was 360 px) | `thumbnailWidth={360}` for an exact match, OR `thumbnailDensity="comfortable"` for adaptive | "comfortable" produces ~200–400 px depending on container |
| `thumbnailSize="default"` (was 480 px) | `thumbnailWidth={480}` or omit | Default in 2.0 is `thumbnailDensity="comfortable"` |
| `thumbnailSize="large"` (was 720 px) | `thumbnailWidth={720}` or `thumbnailDensity="spacious"` | "spacious" produces ~600 px in a typical desktop panel |
| `thumbnailSize={N}` (numeric) | `thumbnailWidth={N}` | **Rename, NOT semantics-identical.** v2 clamps values below 80 px to 80 (touch-target floor) and warns + clamps values above 2048 to 2048. 1.x passed any positive number through unchanged. Consumers using `thumbnailSize` values in [80, 2048] see no change; values outside that range are clamped at the prop boundary. |
| Omitted (was per-page `pageWidth × 0.2`) | omitted (now `thumbnailDensity="comfortable"`) | **Default visual changes.** The per-page `pageWidth × 0.2` mode is removed. For typical 612-px-wide PDFs at a 1000-px panel, thumbnails grow from ~122 px to ~200 px. Mixed-page-size PDFs continue to render per-page widths in density mode via the new median-relative scaling, so visual variety is preserved — only the absolute size changes. |

## 4. `<ThumbnailPanel>` migration table (composable consumers)

| 1.x usage | 2.0 replacement |
|---|---|
| `<ThumbnailPanel size="small" />` | `<ThumbnailPanel width={360} />` or `<ThumbnailPanel density="comfortable" />` |
| `<ThumbnailPanel size="default" />` | `<ThumbnailPanel width={480} />` or omit |
| `<ThumbnailPanel size="large" />` | `<ThumbnailPanel width={720} />` or `<ThumbnailPanel density="spacious" />` |
| `<ThumbnailPanel size={N} />` | `<ThumbnailPanel width={N} />` (same 80–2048 clamp as the Flipbook surface) |
| `<ThumbnailPanel />` (no size) | `<ThumbnailPanel />` (now defaults to `density="comfortable"`) |

## 5. Codemod

Not provided. The rename is mechanical; a project-wide find-and-replace
covers >99 % of cases. Examples for both surfaces:

```bash
# <Flipbook>
sed -i '' 's/thumbnailSize="small"/thumbnailDensity="comfortable"/g' src/**/*.tsx
sed -i '' 's/thumbnailSize="default"/thumbnailDensity="comfortable"/g' src/**/*.tsx
sed -i '' 's/thumbnailSize="large"/thumbnailDensity="spacious"/g' src/**/*.tsx
# Numeric values: rename the prop name; the values pass through.
sed -i '' 's/thumbnailSize={/thumbnailWidth={/g' src/**/*.tsx

# <ThumbnailPanel> composable
sed -i '' 's/<ThumbnailPanel size="small"/<ThumbnailPanel density="comfortable"/g' src/**/*.tsx
sed -i '' 's/<ThumbnailPanel size="large"/<ThumbnailPanel density="spacious"/g' src/**/*.tsx
sed -i '' 's/<ThumbnailPanel size={/<ThumbnailPanel width={/g' src/**/*.tsx
```

Audit results before committing — the discriminated union catches
both-supplied errors at compile time, so `tsc` will flag anything the
rename missed.

## 6. Version pin

```bash
npm install @flipbookjs/react-viewer@^2.0.0
```

The §10 stability surface in `MIGRATION.md` otherwise carries forward
unchanged into 2.x for every other prop, hook, action, state field, and
CSS class. `thumbnailSize` is the only breaking surface change.
