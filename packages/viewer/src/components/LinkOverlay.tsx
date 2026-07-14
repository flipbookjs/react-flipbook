import { useEffect, useMemo, useState } from 'react';
import type { PageSource, LinkAnnotation } from '../types/PageSource';

// Last-mile defensive normalization. LinkOverlay renders links from any
// PageSource impl. The runtime `PdfjsSource` and the api-adapter baker
// both fully validate their outputs — but LinkOverlay also renders links
// from:
//   - Third-party PageSource impls that don't sanitize.
//   - Sidecar bundles baked before api-adapter@1.6.0 (broken data from
//     OLD bakers is still deployed in production).
//   - Bugs upstream.
// So we defensively validate every LinkAnnotation before rendering:
//   - URL scheme: must PARSE (extractable per RFC 3986 §3.1) AND must NOT
//     be in FORBIDDEN. Any other scheme passes — no positive allowlist
//     here, so custom schemes vetted upstream (e.g., PdfjsSource with
//     additionalLinkSchemes: ['intranet']) still render.
//   - Rect: must be 4 finite numbers with strictly positive area.
//   - destPage: must be a non-negative integer.
// Malformed entries drop silently.

const FORBIDDEN_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file']);

function isSafeHref(url: string): boolean {
  const m = url.trim().match(/^([a-z][a-z0-9+.-]*):/i);
  const scheme = m?.[1]?.toLowerCase();
  return !!scheme && !FORBIDDEN_SCHEMES.has(scheme);
}

function isRenderableRect(
  rect: unknown,
): rect is [number, number, number, number] {
  if (!Array.isArray(rect) || rect.length !== 4) return false;
  if (!rect.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  return rect[2] > rect[0] && rect[3] > rect[1];
}

function normalizeRenderableLink(link: LinkAnnotation): LinkAnnotation | null {
  if (!isRenderableRect(link.rect)) return null;
  if (link.url) {
    // Trim once — isSafeHref trims for validation, but if we return the
    // untrimmed original, the DOM anchor's href carries stray whitespace
    // and the aria-label reads "Open link:  https://…". Runtime/baker
    // paths both trim upstream, so this only affects third-party sources
    // and pre-1.6.0 sidecars — cheap correctness on the last-mile fence.
    const trimmed = link.url.trim();
    return isSafeHref(trimmed) ? { ...link, url: trimmed } : null;
  }
  if (typeof link.destPage === 'number') {
    if (!Number.isInteger(link.destPage) || link.destPage < 0) return null;
    return link;
  }
  return null;
}

interface LinkOverlayProps {
  source: PageSource;
  pageIndex: number;
  scale: number;
  /**
   * Called when an intra-document link is clicked. Receives the 0-indexed
   * destination page number as `LinkAnnotation.destPage`. The parent is
   * responsible for translating to whatever page-index convention its
   * navigation API expects.
   */
  onInternalLinkClick: (destPage: number) => void;
}

export function LinkOverlay({
  source, pageIndex, scale, onInternalLinkClick,
}: LinkOverlayProps) {
  const [links, setLinks] = useState<LinkAnnotation[]>([]);

  useEffect(() => {
    // Clear previous page's links immediately. Otherwise, on pageIndex change,
    // the overlay keeps showing stale hit targets from the prior page during
    // the ~50ms fetch window — visible misalignment against the freshly-
    // rendered canvas of the new page.
    setLinks([]);

    if (typeof source.getLinks !== 'function') return;

    const controller = new AbortController();
    source.getLinks(pageIndex, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setLinks(next);
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        // Fail LOUD in dev (House Rule 1). PdfjsSource + baker both emit
        // their own dev warns on failure — this catches third-party
        // PageSource impls that throw outside their own try/catch, so a
        // "no links appear" report can be diagnosed without patching
        // consumer code.
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[flipbook] LinkOverlay: source.getLinks(${pageIndex}) rejected: ${err?.message ?? err}. Rendering no overlay for this page.`,
          );
        }
        setLinks([]);
      });
    return () => { controller.abort(); };
  }, [source, pageIndex]);

  // Normalize once per links-array change. Rejected entries (bad rect,
  // dangerous URL scheme, negative destPage, etc.) drop before render.
  const renderable = useMemo(
    () => links.map(normalizeRenderableLink).filter(
      (l): l is LinkAnnotation => l !== null,
    ),
    [links],
  );

  if (renderable.length === 0) return null;

  return (
    <div className="fbjs-link-overlay">
      {renderable.map((link, i) => {
        const style = {
          left: `${link.rect[0] * scale}px`,
          top: `${link.rect[1] * scale}px`,
          width: `${(link.rect[2] - link.rect[0]) * scale}px`,
          height: `${(link.rect[3] - link.rect[1]) * scale}px`,
        };
        if (link.url) {
          return (
            <a key={i} className="fbjs-link" style={style}
              href={link.url} target="_blank" rel="noopener noreferrer"
              aria-label={`Open link: ${link.url}`}
              data-testid="fbjs-link"
              onPointerDown={(e) => e.stopPropagation()} />
          );
        }
        // Normalizer guarantees destPage is a non-negative integer here.
        const target = link.destPage!;
        return (
          <button key={i} type="button" className="fbjs-link" style={style}
            aria-label={`Go to page ${target + 1}`}
            data-testid="fbjs-link"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onInternalLinkClick(target)} />
        );
      })}
    </div>
  );
}
