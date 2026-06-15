import { Flipbook } from '@flipbookjs/react-viewer';
import '@flipbookjs/react-viewer/styles.css';

// Integrated-smoke demo for the full Step 6 surface. ILLUSTRATIVE, not
// prescriptive — consumers should pass only the props their integration
// actually needs. The toolbar-parts composition pattern (an alternative
// to `toolbar={true}`) is documented in MIGRATION.md §6, not here.
function App() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Flipbook
        url="/Aerospace%20Engineering.pdf"
        viewMode="auto"
        enablePageCurl
        toolbar={true}
        compact={false}
        title="Aerospace Engineering"
        documentName="Aerospace Engineering"
        showPrint
        showDownload
        showFullScreen
        showSelectionMode
        showZoom
        showNavigation
        showThumbnails
        initialTheme="light"
        onThemeChange={(t) => console.log('theme changed', t)}
        printMaxPages={100}
        printScale={2.0}
        printErrorDismissMs={8000}
        onPrintStart={(info) => console.log('print start', info)}
        onPrintComplete={(info) => console.log('print complete', info)}
        onPrintError={(err, info) => console.error('print error', err, info)}
        onPrintAbort={(info) => console.log('print abort', info)}
      />
    </div>
  );
}

export default App;
