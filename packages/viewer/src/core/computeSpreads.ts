export interface Spread {
  left: number | null;
  right: number | null;
}

export function computeSpreads(
  pageCount: number,
  mode: 'single' | 'dual-cover',
  direction: 'ltr' | 'rtl' = 'ltr',
): Spread[] {
  if (mode === 'single') {
    return Array.from({ length: pageCount }, (_, i) => ({
      left: null,
      right: i,
    }));
  }

  // dual-cover
  const spreads: Spread[] = [];
  if (pageCount === 0) return spreads;

  // Cover
  if (direction === 'ltr') {
    spreads.push({ left: null, right: 0 });
  } else {
    spreads.push({ left: 0, right: null });
  }

  // Interior pairs
  for (let i = 1; i < pageCount; i += 2) {
    if (i + 1 < pageCount) {
      if (direction === 'ltr') {
        spreads.push({ left: i, right: i + 1 });
      } else {
        spreads.push({ left: i + 1, right: i });
      }
    } else {
      // Last page alone
      if (direction === 'ltr') {
        spreads.push({ left: i, right: null });
      } else {
        spreads.push({ left: null, right: i });
      }
    }
  }

  return spreads;
}

export function computeSpreadCount(
  pageCount: number,
  mode: 'single' | 'dual-cover',
): number {
  if (pageCount === 0) return 0;
  if (mode === 'single') return pageCount;
  // dual-cover: 1 (cover) + ceil((pageCount - 1) / 2)
  return 1 + Math.ceil((pageCount - 1) / 2);
}

export function getAnchorPage(
  spread: Spread,
  direction: 'ltr' | 'rtl' = 'ltr',
): number {
  if (direction === 'ltr') {
    return spread.left ?? spread.right ?? 0;
  }
  return spread.right ?? spread.left ?? 0;
}

export function pageToSpreadIndex(
  pageIndex: number,
  spreads: Spread[],
): number {
  const idx = spreads.findIndex(
    s => s.left === pageIndex || s.right === pageIndex,
  );
  return Math.max(0, idx); // -1 (not found) → 0
}
