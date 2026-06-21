// Runtime structural validation for `manifest.json` — load-bearing security
// boundary per D14 + house-rules Rule 3. The D14 Part 1/2/3 rules ARE the
// implementation spec; each row becomes one guard clause here.
//
// Returns the typed `Manifest` or throws an `Error` whose message includes
// the field path + violated rule. Per D14 Schema openness: `manifestVersion`
// is strict-equality (closed-on-version), but unknown sibling fields are
// IGNORED (open-on-fields). Additive evolution within `1.x` requires no
// validator changes.

import type { Manifest } from './PreRenderedPageSource';

// ---- D14 Part 1: URL safety for relative artifact refs (everything EXCEPT sourcePdf) ----
//
// RFC 3986 §3.1 URL-scheme grammar: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ).
// Case-insensitive — browsers treat `JAVASCRIPT:` and `Data:` identically to
// their lowercase forms. Anchored to start so a literal ':' mid-path doesn't
// trigger.
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+\-.]*:/;
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/;

// "Semver-ish" sanity check — NOT BNF-strict semver. This intentionally accepts
// some inputs the official semver.org grammar would reject (e.g., "01.0.0" with
// a leading-zero numeric identifier, empty pre-release dot-segments). The check
// exists to catch operationally-relevant typos and bundle corruption ("hello",
// "v1.0.0", "1.0", "1.0.0.0") — NOT to enforce the full BNF grammar. If we ever
// need BNF-strict, pull in the `semver` npm package; until then, the regex is
// honest about being lax.
const SEMVER_ISH_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

// 64-char cap — generous headroom over real-world semver tags. The longest
// real-world tag the author has seen is "1.0.0-alpha+exp.sha.5114f85.build.20231231"
// at ~42 chars; 64 leaves room for further pre-release / build-metadata growth.
// A malicious or buggy producer could otherwise emit a multi-MB pre-release
// suffix that matches the regex; capping bounds validator CPU + adapter-init time.
const CONVERTER_VERSION_MAX_LEN = 64;

function validateUrlSafety(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Manifest validation: ${fieldPath} must be a non-empty string; got ${describe(value)}`);
  }
  if (value !== value.trim()) {
    throw new Error(`Manifest validation: ${fieldPath} must not have leading or trailing whitespace`);
  }
  if (SCHEME_RE.test(value)) {
    throw new Error(`Manifest validation: ${fieldPath} must be a relative path, not a scheme-prefixed URL; got "${value}"`);
  }
  if (value.startsWith('//')) {
    throw new Error(`Manifest validation: ${fieldPath} must not be protocol-relative; got "${value}"`);
  }
  if (value.includes('\\')) {
    throw new Error(`Manifest validation: ${fieldPath} must not contain backslash; got "${value}"`);
  }
  if (CONTROL_CHARS_RE.test(value)) {
    throw new Error(`Manifest validation: ${fieldPath} must not contain control characters`);
  }
  // Reject any path segment that equals `..` exactly. Splitting on `/` is
  // sufficient because backslash was already rejected above.
  const segments = value.split('/');
  if (segments.includes('..')) {
    throw new Error(`Manifest validation: ${fieldPath} must not contain a '..' path segment; got "${value}"`);
  }
}

// ---- D14 Part 2: URL safety for sourcePdf (relative OR absolute http(s)://) ----

const HTTP_SCHEME_RE = /^https?:\/\//i;

function validateSourcePdfUrl(
  value: unknown,
  bundleUrl: string | undefined,
  fieldPath: string,
): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Manifest validation: ${fieldPath} must be a non-empty string; got ${describe(value)}`);
  }
  if (value !== value.trim()) {
    throw new Error(`Manifest validation: ${fieldPath} must not have leading or trailing whitespace`);
  }
  if (CONTROL_CHARS_RE.test(value)) {
    throw new Error(`Manifest validation: ${fieldPath} must not contain control characters`);
  }

  // Distinguish absolute http(s) (allowed exception) from any other absolute
  // scheme (rejected). Use the case-insensitive HTTP regex; any other
  // scheme-prefixed value reaches the SCHEME_RE branch below for Part 1.
  if (HTTP_SCHEME_RE.test(value)) {
    // Absolute http(s): must be parseable + must pass host policy.
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`Manifest validation: ${fieldPath} is not a valid URL; got "${value}"`);
    }
    validateSourcePdfHostPolicy(parsed, bundleUrl, fieldPath);
    return;
  }

  // Not absolute http(s). If it has ANY scheme prefix, reject (Part 2 allows
  // ONLY http/https as absolute schemes). Otherwise treat as relative bundle
  // path and apply Part 1 rules.
  if (SCHEME_RE.test(value)) {
    throw new Error(
      `Manifest validation: ${fieldPath} must be a relative path or an absolute http(s):// URL; got "${value}"`,
    );
  }
  validateUrlSafety(value, fieldPath);
}

function validateSourcePdfHostPolicy(
  sourcePdfUrl: URL,
  bundleUrl: string | undefined,
  fieldPath: string,
): void {
  let expectedOrigin: string | null = null;

  // Try bundleUrl as absolute first.
  if (bundleUrl !== undefined) {
    try {
      expectedOrigin = new URL(bundleUrl).origin;
    } catch {
      // bundleUrl was relative — fall through to window.location.
    }
  }

  if (expectedOrigin === null) {
    // Relative bundleUrl (or none): compare against window.location.origin.
    // Defensive: throw if window isn't available (non-browser env — adapter is
    // browser-only per A7, but loud failure beats silent allow).
    if (typeof window === 'undefined') {
      throw new Error(
        `Manifest validation: ${fieldPath} host policy requires window.location.origin (relative bundleUrl), but window is not available`,
      );
    }
    const origin = window.location.origin;
    // jsdom and modern browsers represent opaque origins as the string 'null'.
    // Refuse to compare — same-origin is undefined for opaque origins.
    if (origin === 'null' || origin === null) {
      throw new Error(
        `Manifest validation: ${fieldPath} host policy cannot be evaluated when window.location.origin is "null" (file://, sandboxed iframe, etc.)`,
      );
    }
    expectedOrigin = origin;
  }

  if (sourcePdfUrl.origin !== expectedOrigin) {
    throw new Error(
      `Manifest validation: ${fieldPath} cross-origin not permitted; ${sourcePdfUrl.origin} does not match ${expectedOrigin}`,
    );
  }
}

// ---- D14 Part 3: Structural validation (one guard per field) ----

function validateNonEmptyString(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Manifest validation: ${fieldPath} must be a non-empty string; got ${describe(value)}`);
  }
}

function validateStatusEnum(value: unknown, fieldPath: string): void {
  if (value !== 'ready' && value !== 'pending' && value !== 'failed') {
    throw new Error(`Manifest validation: ${fieldPath} must be 'ready' | 'pending' | 'failed'; got ${describe(value)}`);
  }
}

function validateIsoDateTime(value: unknown, fieldPath: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Manifest validation: ${fieldPath} must be a parseable ISO 8601 datetime; got ${describe(value)}`);
  }
}

function validatePositiveInteger(value: unknown, fieldPath: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Manifest validation: ${fieldPath} must be a positive integer; got ${describe(value)}`);
  }
}

function validateWidthsArray(value: unknown, fieldPath: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Manifest validation: ${fieldPath} must be a non-empty array; got ${describe(value)}`);
  }
  for (let i = 0; i < value.length; i++) {
    const w = value[i];
    if (typeof w !== 'number' || !Number.isInteger(w) || w <= 0) {
      throw new Error(`Manifest validation: ${fieldPath}[${i}] must be a positive integer; got ${describe(w)}`);
    }
    if (i > 0 && w <= value[i - 1]) {
      throw new Error(
        `Manifest validation: ${fieldPath} must be sorted strictly ascending (no duplicates); ${fieldPath}[${i}]=${w} <= ${fieldPath}[${i - 1}]=${value[i - 1]}`,
      );
    }
  }
  return value as number[];
}

function validateTemplate(
  value: unknown,
  required: string[],
  fieldPath: string,
): void {
  validateUrlSafety(value, fieldPath);
  for (const placeholder of required) {
    if (!(value as string).includes(`{${placeholder}}`)) {
      throw new Error(
        `Manifest validation: ${fieldPath} must contain placeholder {${placeholder}}; got "${value}"`,
      );
    }
  }
}

function validateRotation(value: unknown, fieldPath: string): 0 | 90 | 180 | 270 {
  if (value !== 0 && value !== 90 && value !== 180 && value !== 270) {
    throw new Error(`Manifest validation: ${fieldPath} must be 0|90|180|270; got ${describe(value)}`);
  }
  return value;
}

function validateSize(value: unknown, fieldPath: string): [number, number] {
  if (
    !Array.isArray(value)
    || value.length !== 2
    || typeof value[0] !== 'number'
    || typeof value[1] !== 'number'
    || !(value[0] > 0)
    || !(value[1] > 0)
  ) {
    throw new Error(
      `Manifest validation: ${fieldPath} must be [width, height] with both positive numbers; got ${describe(value)}`,
    );
  }
  return [value[0], value[1]];
}

interface DefaultsValidated {
  widths: number[];
  format: 'webp';
  tierUrlTemplate: string;
  sidecarUrlTemplate: string;
  pageNumberDigits: number;
}

function validateDefaults(value: unknown, fieldPath: string): DefaultsValidated {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Manifest validation: ${fieldPath} must be an object; got ${describe(value)}`);
  }
  const d = value as Record<string, unknown>;
  const widths = validateWidthsArray(d.widths, `${fieldPath}.widths`);
  if (d.format !== 'webp') {
    throw new Error(`Manifest validation: ${fieldPath}.format must be 'webp'; got ${describe(d.format)}`);
  }
  validateTemplate(d.tierUrlTemplate, ['page', 'width', 'format'], `${fieldPath}.tierUrlTemplate`);
  validateTemplate(d.sidecarUrlTemplate, ['page', 'sidecar'], `${fieldPath}.sidecarUrlTemplate`);
  const pnd = d.pageNumberDigits;
  if (typeof pnd !== 'number' || !Number.isInteger(pnd) || pnd < 1 || pnd > 9) {
    throw new Error(
      `Manifest validation: ${fieldPath}.pageNumberDigits must be an integer in [1, 9]; got ${describe(pnd)}`,
    );
  }
  return {
    widths,
    format: 'webp',
    tierUrlTemplate: d.tierUrlTemplate as string,
    sidecarUrlTemplate: d.sidecarUrlTemplate as string,
    pageNumberDigits: pnd,
  };
}

interface PageEntryValidated {
  size: [number, number];
  rotation: 0 | 90 | 180 | 270;
  label?: string;
}

function validatePages(
  value: unknown,
  pageCount: number,
  fieldPath: string,
): PageEntryValidated[] {
  if (!Array.isArray(value)) {
    throw new Error(`Manifest validation: ${fieldPath} must be an array; got ${describe(value)}`);
  }
  if (value.length !== pageCount) {
    throw new Error(
      `Manifest validation: ${fieldPath}.length (${value.length}) must equal pageCount (${pageCount})`,
    );
  }
  const out: PageEntryValidated[] = [];
  let firstSize: [number, number] | null = null;
  let firstRotation: 0 | 90 | 180 | 270 | null = null;
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Manifest validation: ${fieldPath}[${i}] must be an object; got ${describe(entry)}`);
    }
    const e = entry as Record<string, unknown>;
    const size = validateSize(e.size, `${fieldPath}[${i}].size`);
    const rotation = validateRotation(e.rotation, `${fieldPath}[${i}].rotation`);

    // D13 cross-constraint — all pages must share size + rotation.
    if (firstSize === null) {
      firstSize = size;
    } else if (size[0] !== firstSize[0] || size[1] !== firstSize[1]) {
      throw new Error(
        `Manifest validation: ${fieldPath}[${i}].size [${size}] differs from ${fieldPath}[0].size [${firstSize}] (D13: uniform page size required)`,
      );
    }
    if (firstRotation === null) {
      firstRotation = rotation;
    } else if (rotation !== firstRotation) {
      throw new Error(
        `Manifest validation: ${fieldPath}[${i}].rotation ${rotation} differs from ${fieldPath}[0].rotation ${firstRotation} (D13: uniform rotation required)`,
      );
    }
    const labelRaw = e.label;
    if (labelRaw !== undefined && typeof labelRaw !== 'string') {
      throw new Error(`Manifest validation: ${fieldPath}[${i}].label must be a string when present; got ${describe(labelRaw)}`);
    }
    const validated: PageEntryValidated = { size, rotation };
    if (typeof labelRaw === 'string') validated.label = labelRaw;
    out.push(validated);
  }
  return out;
}

interface DocumentArtifactsValidated {
  outline: string;
  search?: string;
  seo?: string;
  accessibilityReport?: string;
  sourcePdf?: string;
}

function validateDocumentArtifacts(
  value: unknown,
  bundleUrl: string | undefined,
  fieldPath: string,
): DocumentArtifactsValidated {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Manifest validation: ${fieldPath} must be an object; got ${describe(value)}`);
  }
  const d = value as Record<string, unknown>;
  validateUrlSafety(d.outline, `${fieldPath}.outline`);
  const out: DocumentArtifactsValidated = { outline: d.outline as string };
  if (d.search !== undefined) {
    validateUrlSafety(d.search, `${fieldPath}.search`);
    out.search = d.search as string;
  }
  if (d.seo !== undefined) {
    validateUrlSafety(d.seo, `${fieldPath}.seo`);
    out.seo = d.seo as string;
  }
  if (d.accessibilityReport !== undefined) {
    validateUrlSafety(d.accessibilityReport, `${fieldPath}.accessibilityReport`);
    out.accessibilityReport = d.accessibilityReport as string;
  }
  if (d.sourcePdf !== undefined) {
    validateSourcePdfUrl(d.sourcePdf, bundleUrl, `${fieldPath}.sourcePdf`);
    out.sourcePdf = d.sourcePdf as string;
  }
  return out;
}

interface OverrideEntryValidated {
  widths?: number[];
  tierUrls?: Record<number, string>;
}

function validateOverrides(
  value: unknown,
  pageCount: number,
  pageNumberDigits: number,
  fieldPath: string,
): Record<string, OverrideEntryValidated> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Manifest validation: ${fieldPath} must be an object; got ${describe(value)}`);
  }
  const out: Record<string, OverrideEntryValidated> = {};
  const keyPattern = new RegExp(`^\\d{${pageNumberDigits}}$`);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!keyPattern.test(key)) {
      throw new Error(
        `Manifest validation: ${fieldPath} key "${key}" must match /^\\d{${pageNumberDigits}}$/ (zero-padded page id)`,
      );
    }
    const num = Number.parseInt(key, 10);
    if (num < 1 || num > pageCount) {
      throw new Error(
        `Manifest validation: ${fieldPath} key "${key}" parses to ${num}, outside [1, ${pageCount}]`,
      );
    }
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Manifest validation: ${fieldPath}.${key} must be an object; got ${describe(entry)}`);
    }
    const e = entry as Record<string, unknown>;
    const validated: OverrideEntryValidated = {};
    if (e.widths !== undefined) {
      validated.widths = validateWidthsArray(e.widths, `${fieldPath}.${key}.widths`);
    }
    if (e.tierUrls !== undefined) {
      if (typeof e.tierUrls !== 'object' || e.tierUrls === null) {
        throw new Error(`Manifest validation: ${fieldPath}.${key}.tierUrls must be an object; got ${describe(e.tierUrls)}`);
      }
      const tu = e.tierUrls as Record<string, unknown>;
      const tierUrlsOut: Record<number, string> = {};
      for (const tk of Object.keys(tu)) {
        // Tier-URL keys are widths (number); JSON serializes as string keys.
        // Validate the value is URL-safe; key itself is just a number-coerced
        // lookup key, no validation needed beyond "is a number".
        const widthKey = Number.parseInt(tk, 10);
        if (!Number.isInteger(widthKey) || widthKey <= 0) {
          throw new Error(
            `Manifest validation: ${fieldPath}.${key}.tierUrls key "${tk}" must be a positive integer width`,
          );
        }
        validateUrlSafety(tu[tk], `${fieldPath}.${key}.tierUrls[${tk}]`);
        tierUrlsOut[widthKey] = tu[tk] as string;
      }
      validated.tierUrls = tierUrlsOut;
    }
    out[key] = validated;
  }
  return out;
}

// ---- Top-level entry point ----

export function validateManifest(raw: unknown, bundleUrl?: string): Manifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Manifest validation: top-level value must be an object');
  }
  const m = raw as Record<string, unknown>;

  // Closed-on-version gate: strict equality. Any other value fails fast.
  // Unknown sibling fields are NOT rejected — open-schema posture per D14.
  if (m.manifestVersion !== 1) {
    throw new Error(
      `Manifest validation: unsupported manifestVersion: ${describe(m.manifestVersion)}; this adapter only loads manifestVersion === 1`,
    );
  }

  validateNonEmptyString(m.documentId, 'documentId');
  validateNonEmptyString(m.contentHash, 'contentHash');
  validateStatusEnum(m.status, 'status');
  validateIsoDateTime(m.generatedAt, 'generatedAt');
  validatePositiveInteger(m.pageCount, 'pageCount');
  const pageCount = m.pageCount as number;

  if (m.converterVersion !== undefined) {
    validateNonEmptyString(m.converterVersion, 'converterVersion');
    if ((m.converterVersion as string).length > CONVERTER_VERSION_MAX_LEN) {
      throw new Error(
        `Manifest validation: converterVersion exceeds ${CONVERTER_VERSION_MAX_LEN}-char cap; got ${(m.converterVersion as string).length} chars`,
      );
    }
    if (!SEMVER_ISH_RE.test(m.converterVersion as string)) {
      throw new Error(
        `Manifest validation: converterVersion must be MAJOR.MINOR.PATCH shape (semver-ish); got ${describe(m.converterVersion)}`,
      );
    }
  }

  const defaults = validateDefaults(m.defaults, 'defaults');

  // SDR1 cross-constraint — pageNumberDigits sufficient for pageCount.
  // pageId() uses padStart, which is a no-op when the number is already
  // longer than the target length. Without this check, the runtime would
  // emit "10" for page 10 (2 chars) while the override-key validator
  // demands "^\d{1}$" — internal inconsistency.
  const maxRepresentable = Math.pow(10, defaults.pageNumberDigits) - 1;
  if (pageCount > maxRepresentable) {
    const minDigitsNeeded = Math.ceil(Math.log10(pageCount + 1));
    throw new Error(
      `Manifest validation: pageNumberDigits=${defaults.pageNumberDigits} can only represent ${maxRepresentable} pages; pageCount=${pageCount} requires at least ${minDigitsNeeded} digits`,
    );
  }

  const pages = validatePages(m.pages, pageCount, 'pages');
  const documentArtifacts = validateDocumentArtifacts(m.documentArtifacts, bundleUrl, 'documentArtifacts');

  let overrides: Record<string, OverrideEntryValidated> | undefined;
  if (m.overrides !== undefined) {
    overrides = validateOverrides(m.overrides, pageCount, defaults.pageNumberDigits, 'overrides');
  }

  // Re-assemble a typed Manifest from validated parts. Per Schema openness,
  // we deliberately do NOT copy unrecognized fields — they were present on
  // the input but the typed value carries only the known surface.
  const out: Manifest = {
    manifestVersion: 1,
    documentId: m.documentId as string,
    contentHash: m.contentHash as string,
    status: m.status as 'ready' | 'pending' | 'failed',
    generatedAt: m.generatedAt as string,
    pageCount,
    defaults,
    pages,
    documentArtifacts,
  };
  if (overrides !== undefined) out.overrides = overrides;
  if (m.converterVersion !== undefined) out.converterVersion = m.converterVersion as string;
  return out;
}

// ---- Helpers ----

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return 'object';
  return typeof value;
}
