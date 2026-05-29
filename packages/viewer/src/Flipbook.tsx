'use client';

import { type ReactNode, useMemo } from 'react';
import type { PageSource } from './types/PageSource';
import type { DefaultScale } from './zoom/types';
import { PdfjsSource } from './adapters/PdfjsSource';
import { FlipbookProvider } from './FlipbookProvider';

export interface FlipbookProps {
  url?: string;
  source?: PageSource;
  viewMode?: 'single' | 'dual-cover' | 'auto';
  initialPage?: number;
  renderError?: (error: Error) => ReactNode;
  renderLoading?: () => ReactNode;
  /** Enable page-curl animation on pointer/wheel interactions. Defaults to false (opt-in).
   *  Only active when resolvedViewMode === 'dual-cover'. Curl engine lazy-loaded. */
  enablePageCurl?: boolean;
  /** Initial zoom mode or scale. String values map to fit modes; numeric values map
   *  to custom scale (clamped to [0.1, 4] at the factory boundary per architectural
   *  plan Decision 6). Defaults to `'fit-page'`. SpecialZoomLevel enum members
   *  (PageFit, PageWidth, ActualSize) are valid here — their string literal values
   *  match this union by design. Uncontrolled prop: only the INITIAL value is read;
   *  to change zoom at runtime, dispatch via toolbar (Step 6) or remount with a
   *  fresh React key (see Scenario F in architectural plan). */
  defaultScale?: DefaultScale;
}

export function Flipbook({
  url,
  source,
  viewMode,
  initialPage = 0,
  renderError,
  renderLoading,
  enablePageCurl = false,
  defaultScale = 'fit-page',
}: FlipbookProps) {
  const internalSource = useMemo(
    () => (url ? new PdfjsSource(url) : null),
    [url],
  );
  const effectiveSource = source ?? internalSource;

  if (!effectiveSource) {
    throw new Error('Flipbook requires either a `url` or `source` prop');
  }

  if (process.env.NODE_ENV !== 'production' && url && source) {
    console.warn(
      'Flipbook: both `url` and `source` provided. `source` takes precedence. Remove one.',
    );
  }

  return (
    <FlipbookProvider
      source={effectiveSource}
      viewMode={viewMode}
      initialPage={initialPage}
      renderError={renderError}
      renderLoading={renderLoading}
      enablePageCurl={enablePageCurl}
      defaultScale={defaultScale}
    />
  );
}
