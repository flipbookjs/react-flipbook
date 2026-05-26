import { createContext } from 'react';

/**
 * Registry entry. Shape matches old fork's types.ts; re-exported from
 * src/curl/types.ts for the curl files' existing import path.
 *
 * Both fields nullable: a page may register its element before its canvas
 * is ready, or vice versa.
 */
export interface PageRegistryEntry {
  canvas: HTMLCanvasElement | null;
  element: HTMLDivElement | null;
}

/**
 * Write-side: stable methods. PageRenderer consumes this.
 * Context value reference NEVER changes — consumers don't re-render on registry mutations.
 */
export interface PageRegistryWrite {
  register(pageIndex: number, entry: PageRegistryEntry): void;
  unregister(pageIndex: number): void;
}

/**
 * Read-side: subscription + lookup. CurlOverlay consumes this in 3B via useSyncExternalStore.
 */
export interface PageRegistryRead {
  get(pageIndex: number): PageRegistryEntry | undefined;
  /** Subscribe to registry changes. Returns unsubscribe. Subscribers fire synchronously inside register/unregister. */
  subscribe(callback: () => void): () => void;
  /** Snapshot for useSyncExternalStore — monotonic version number. */
  getSnapshot(): number;
  /** Stable server-side snapshot for SSR safety (per AS1). Registry is empty on server. */
  getServerSnapshot(): number;
}

export const PageRegistryWriteContext = createContext<PageRegistryWrite | null>(null);
export const PageRegistryReadContext = createContext<PageRegistryRead | null>(null);

/**
 * Creates the registry pair. Used internally by FlipbookProvider in 3B.
 * Exported here so tests can construct registries in isolation.
 *
 * Idempotency contract (per architectural plan Decision 3):
 * - register(pageIndex, entry) is idempotent by pageIndex.
 *   If existing entry has same canvas+element refs, skip version bump.
 * - unregister(pageIndex) is idempotent — removing a non-existent index is a no-op.
 *
 * This makes React Strict Mode's synthetic double-effect cycle produce minimal subscriber noise.
 */
export function createPageRegistry(): { write: PageRegistryWrite; read: PageRegistryRead } {
  const map = new Map<number, PageRegistryEntry>();
  const subscribers = new Set<() => void>();
  let version = 0;

  function notify(): void {
    // Synchronous notification per architectural plan Decision 3.
    // useSyncExternalStore's contract relies on getSnapshot returning up-to-date
    // value immediately after subscribers fire — sync notify keeps that trivially true.
    for (const cb of subscribers) cb();
  }

  const write: PageRegistryWrite = {
    register(pageIndex, entry) {
      const existing = map.get(pageIndex);
      if (existing && existing.canvas === entry.canvas && existing.element === entry.element) {
        // Same refs — Strict Mode re-register with no actual change. Skip bump.
        return;
      }
      map.set(pageIndex, entry);
      version++;
      notify();
    },
    unregister(pageIndex) {
      if (!map.has(pageIndex)) return; // Idempotent: no-op for non-existent index.
      map.delete(pageIndex);
      version++;
      notify();
    },
  };

  const read: PageRegistryRead = {
    get(pageIndex) {
      return map.get(pageIndex);
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => { subscribers.delete(callback); };
    },
    getSnapshot() {
      return version;
    },
    getServerSnapshot() {
      // Registry is empty on server; return stable 0 per AS1.
      return 0;
    },
  };

  return { write, read };
}
