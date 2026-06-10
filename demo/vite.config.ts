import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  // Sample PDFs live at the repo root (test-pdfs/) so they're easy to find
  // when adding new fixtures. Files there are served at the site root, so
  // <Flipbook url="/foo.pdf" /> resolves to test-pdfs/foo.pdf.
  publicDir: resolve(import.meta.dirname, '../../../test-pdfs'),
});
