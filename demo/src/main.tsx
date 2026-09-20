import { createRoot } from 'react-dom/client';
import { configurePdfWorker } from '@flipbookjs/react-viewer';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import App from './App';

// Same shape the README and migration guide recommend: the worker that ships with
// the installed pdfjs-dist, served from our own origin.
configurePdfWorker(workerSrc);

createRoot(document.getElementById('root')!).render(<App />);
