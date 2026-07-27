import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, normalize, sep } from 'path';
import fs from 'fs';

// Path math verified: demo/ → react-flipbook/ → dev/ → publi-flipbook/ (repo root).
const BUNDLES_ROOT = resolve(import.meta.dirname, '../../../converted-bundles');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-converted-bundles',
      configureServer(server) {
        server.middlewares.use('/converted-bundles', (req, res, next) => {
          let urlPath: string;
          try {
            urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
          } catch {
            res.statusCode = 400;
            res.end('bad request');
            return;
          }
          const rel = normalize(urlPath.replace(/^\/+/, ''));
          const filePath = resolve(BUNDLES_ROOT, rel);
          const rootWithSep = BUNDLES_ROOT.endsWith(sep) ? BUNDLES_ROOT : BUNDLES_ROOT + sep;
          if (filePath !== BUNDLES_ROOT && !filePath.startsWith(rootWithSep)) {
            res.statusCode = 403;
            res.end('forbidden');
            return;
          }
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Cache-Control', 'no-cache');
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });
      },
    },
  ],
  // Don't pre-bundle the workspace viewer — otherwise Vite caches its built `dist`
  // in node_modules/.vite and won't pick up rebuilds without a --force restart.
  // Excluded => served directly, so `npm -w packages/viewer run build` + browser
  // refresh always reflects the latest viewer build.
  optimizeDeps: { exclude: ['@flipbookjs/react-viewer'] },
  publicDir: resolve(import.meta.dirname, '../../../test-pdfs'),
});