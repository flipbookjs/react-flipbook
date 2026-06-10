import { useState, useEffect } from 'react';
import type { PageSource } from '../types/PageSource';

export type SourceState =
  | { status: 'loading' }
  | { status: 'ready'; source: PageSource }
  | { status: 'error'; error: Error; source: PageSource };

export function usePageSource(source: PageSource): SourceState {
  const [state, setState] = useState<SourceState>({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });

    let disposed = false;

    source.init()
      .then(() => {
        if (!disposed) {
          setState({ status: 'ready', source });
        }
      })
      .catch((err) => {
        if (!disposed) {
          setState({ status: 'error', error: err, source });
        }
      });

    return () => {
      disposed = true;
      source.dispose();
    };
  }, [source]);

  return state;
}
