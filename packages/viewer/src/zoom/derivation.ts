/**
 * Pure function implementing Decisions 3 + 10 of the architectural plan:
 * computes effectiveScale (across all three zoom modes) and isOverflowing
 * (either-dimension strict overflow against the unpadded container).
 *
 * Extracted from FlipbookProvider's useMemo for direct unit-testability
 * (M2 fix from template-1 review — the prior plan tested the reducer + helpers
 * but not the load-bearing math itself; refactoring inside FlipbookProvider
 * would be undetected by the test suite).
 *
 * The wrapping useMemo in FlipbookProvider preserves the loading-phase guard
 * (`if (!isReady || pageCount === 0 || containerWidth === 0 || containerHeight === 0) ...`)
 * before calling this; this function assumes valid inputs (containerWidth + Height > 0).
 *
 * **Type-input narrowing (L1 fix from template-5/6 review):** DeriveInputs uses
 * inline literal unions for zoomMode + resolvedViewMode rather than indexing into
 * FlipbookState. This keeps zoom/derivation.ts a true leaf module — no imports
 * from core/. Minor type-string duplication is the cost; TypeScript flags any
 * call-site mismatch if a union member is renamed in flipbookReducer.ts.
 */
export interface DeriveInputs {
  zoomMode: 'fit-page' | 'fit-width' | 'custom';
  customScale: number;
  resolvedViewMode: 'single' | 'dual-cover';
  containerWidth: number;
  containerHeight: number;
  pageWidth: number;
  pageHeight: number;
}

export interface DeriveOutputs {
  effectiveScale: number;
  isOverflowing: boolean;
}

export function deriveEffectiveScaleAndOverflow(inputs: DeriveInputs): DeriveOutputs {
  const { zoomMode, customScale, resolvedViewMode, containerWidth, containerHeight, pageWidth, pageHeight } = inputs;

  const spreadWidth = resolvedViewMode === 'dual-cover' ? pageWidth * 2 : pageWidth;
  const spreadHeight = pageHeight;

  const CONTAINER_PADDING = 16;
  // Div-by-zero floor preserved from Step 2 (see Phase 3 useMemo comment).
  const MIN_AVAILABLE = 1;
  const availableWidth = Math.max(MIN_AVAILABLE, containerWidth - CONTAINER_PADDING * 2);
  const availableHeight = Math.max(MIN_AVAILABLE, containerHeight - CONTAINER_PADDING * 2);

  let effectiveScale: number;
  if (zoomMode === 'custom') {
    effectiveScale = customScale;
  } else if (zoomMode === 'fit-width') {
    effectiveScale = availableWidth / spreadWidth;
  } else {
    // 'fit-page' — Step 2's existing behavior preserved verbatim.
    const scaleX = availableWidth / spreadWidth;
    const scaleY = availableHeight / spreadHeight;
    effectiveScale = Math.min(scaleX, scaleY);
  }

  // Decision 10: either-dimension strict overflow against unpadded container
  // (padding is a visual margin, not a hard cap).
  const scaledWidth = effectiveScale * spreadWidth;
  const scaledHeight = effectiveScale * spreadHeight;
  const isOverflowing = scaledWidth > containerWidth || scaledHeight > containerHeight;

  return { effectiveScale, isOverflowing };
}
