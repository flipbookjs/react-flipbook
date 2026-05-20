'use client';

import { type ReactNode, useMemo } from 'react';
import type { PageSource } from './types/PageSource';
import { PdfjsSource } from './adapters/PdfjsSource';
import { FlipbookProvider } from './FlipbookProvider';

export interface FlipbookProps {
  url?: string;
  source?: PageSource;
  viewMode?: 'single' | 'dual-cover' | 'auto';
  initialPage?: number;
  renderError?: (error: Error) => ReactNode;
  renderLoading?: () => ReactNode;
}

export function Flipbook({
  url,
  source,
  viewMode,
  initialPage = 0,
  renderError,
  renderLoading,
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
    />
  );
}
