/**
 * The platform record describing a flipbook's lifecycle. Mirrors the shape
 * locked in `flipbook-document-contract-v1.md` §2; per-field semantics
 * (presence rules, durability, generation timing) live in the contract.
 * Treat that document as the source of truth — these JSDoc comments here
 * are intentionally minimal to avoid drift between the wire-contract and
 * the type-contract. When in doubt, read the contract.
 *
 * @see flipbook-document-contract-v1.md §2 (record schema)
 * @see flipbook-document-contract-v1.md §3 (status state machine)
 * @see flipbook-document-contract-v1.md §4 (URL invariants)
 */
export interface FlipbookDocument {
  /** Stable identifier. */
  id: string;
  /** Owning team / workspace; authorization scope. */
  teamId: string;
  /** Human-facing display name. */
  title: string;
  /** PDF URL (MAY be ephemeral; see contract §4.1). */
  sourcePdfUrl: string;
  /** Durable storage key (see contract §2). */
  sourceFileId?: string;
  /** Bundle root URL; required when status is `'ready'`, MAY be present when status is `'stale'` under the operator's stale-keeps-old-bytes policy (see contract §3 + §4.2). */
  artifactManifestUrl?: string;
  /** Opaque bundle version tag. */
  artifactVersion?: string;
  /** Lifecycle state; see contract §3 for transitions. */
  status: FlipbookDocumentStatus;
  /** Source PDF page count, when known. */
  pageCount?: number;
  /** SHA-256 of source PDF; deduplication signal. */
  sourceSha256?: string;
  /** Correlation key for the most recent conversion job. */
  conversionJobId?: string;
  /** Operator-facing failure summary when status is `'failed'`. */
  errorMessage?: string;
  /** Reserved slot for forward-compatible operator metadata; adapter ignores. */
  _meta?: Record<string, unknown>;
}

export type FlipbookDocumentStatus =
  | 'uploaded'
  | 'converting'
  | 'ready'
  | 'failed'
  | 'stale';
