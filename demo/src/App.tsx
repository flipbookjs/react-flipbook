import { useMemo } from 'react';
import { Flipbook } from '@flipbookjs/react-viewer';
import { PreRenderedPageSource } from '@flipbookjs/api-adapter';
import '@flipbookjs/react-viewer/styles.css';

const DEFAULT_PDF = '/Aerospace%20Engineering.pdf';

function App() {
  const params = new URLSearchParams(window.location.search);
  const bundleParam = params.get('bundle');
  const urlParam = params.get('url');

  const preRenderedSource = useMemo(
    () => (bundleParam ? new PreRenderedPageSource({ bundleUrl: bundleParam }) : null),
    [bundleParam],
  );

  const sharedProps = {
    viewMode: 'auto' as const,
    enablePageCurl: true,
    toolbar: true as const,
    compact: false,
    title: 'Aerospace Engineering',
    documentName: 'Aerospace Engineering',
    showPrint: true,
    showDownload: true,
    showFullScreen: true,
    showSelectionMode: true,
    showZoom: true,
    showNavigation: true,
    showThumbnails: true,
    initialTheme: 'light' as const,
    onThemeChange: (t: string) => console.log('theme changed', t),
    printMaxPages: 100,
    printScale: 2.0,
    printErrorDismissMs: 8000,
    onPrintStart: (info: unknown) => console.log('print start', info),
    onPrintComplete: (info: unknown) => console.log('print complete', info),
    onPrintError: (err: unknown, info: unknown) => console.error('print error', err, info),
    onPrintAbort: (info: unknown) => console.log('print abort', info),
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {bundleParam && preRenderedSource ? (
        <Flipbook source={preRenderedSource} {...sharedProps} />
      ) : urlParam ? (
        <Flipbook url={urlParam} {...sharedProps} />
      ) : (
        <Flipbook url={DEFAULT_PDF} {...sharedProps} />
      )}
    </div>
  );
}

export default App;
