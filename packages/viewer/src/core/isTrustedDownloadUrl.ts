/**
 * Whether a consumer-supplied `downloadUrl` may be navigated to.
 *
 * The trusted download path deliberately drops both `download` and
 * `target="_blank"`, because a server-declared `Content-Disposition:
 * attachment` is what turns the navigation into a download. Dropping `target`
 * is what removes the tab flash — and it is also what makes this check
 * necessary.
 *
 * Measured, because the result is counter-intuitive: an anchor clicked with
 * `href="javascript:…"` runs the script when it is plain, AND when it carries
 * `download` — the `download` attribute is not a shield. Only
 * `target="_blank"` is: the browser refuses the URL there. The source-URL path
 * in `FlipbookProvider` is safe because of its `_blank`, not because of its
 * `download`. This path drops both, so the scheme is checked here instead.
 * Anyone removing `_blank` from that path later needs this guard on it too.
 *
 * Accepts `http:` and `https:` only. A relative URL resolves against the page
 * and is therefore accepted on an http(s) page. Everything else —
 * `javascript:`, `data:`, `blob:`, `file:`, `vbscript:`, custom schemes — is
 * rejected: none of them can carry a Content-Disposition response, so none of
 * them can be the trusted URL this path is for.
 *
 * Empty and whitespace-only input are rejected explicitly. They would
 * otherwise resolve against the page and report `http:` — i.e. `true` — which
 * is the one case where deferring to `new URL()` gives the wrong answer. The
 * caller trims before asking, so this is belt-and-braces, but a guard that
 * approves an empty string is a trap for the next caller.
 *
 * SSR-safe: with no `window` to resolve against, the answer is `false` and the
 * caller falls through to the source-URL path.
 */
export function isTrustedDownloadUrl(url: string): boolean {
  if (typeof window === 'undefined') return false;
  if (url.trim().length === 0) return false;
  try {
    const { protocol } = new URL(url, window.location.href);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
