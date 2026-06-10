import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    react(),
    dts({ bundleTypes: true }),
  ],
  build: {
    lib: {
      // Multi-entry library mode: two entries produce dist/index.{js,cjs} and
      // dist/toolbar-parts.{js,cjs}. The dts plugin emits matching .d.ts files.
      // Side-effect CSS imports (flipbook.css) dedupe across entries thanks to
      // cssCodeSplit: false below.
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        'toolbar-parts': resolve(import.meta.dirname, 'src/toolbar/parts.ts'),
      },
      formats: ['es', 'cjs'],
      // fileName is called per entry per format. The first arg is the format,
      // the second is the entry NAME from the entry map ('index' or
      // 'toolbar-parts'). Map both to the matching extension.
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      cssFileName: 'styles',
    },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      // Manual chunk grouping forces shared internal modules (the 6A hook
      // layer + 6B's icons/labels/composeHandlers/useToolbarPart) into a
      // single shared chunk. Without this, rolldown may inline shared code
      // into BOTH dist/index.js AND dist/toolbar-parts.js — consumers using
      // both entries pay double for the shared layer.
      //
      // The function receives the module's absolute path; we group:
      //   - All `src/hooks/*` (useFlipbook, shallowEqual, etc.) → 'hooks' chunk
      //   - All `src/toolbar/icons.tsx` + `src/toolbar/labels.ts` → 'toolbar-shared'
      //   - All `src/toolbar/composeHandlers.ts` → 'toolbar-shared'
      //   - All `src/toolbar/useToolbarPart.ts` + `ToolbarShellContext.ts` → 'toolbar-shared'
      // Result: dist/hooks-XXX.js (shared by index + toolbar-parts);
      //         dist/toolbar-shared-XXX.js (used only by toolbar-parts; no main
      //         entry impact, but groups internal toolbar primitives so they
      //         tree-shake as a unit when toolbar-parts itself is imported).
      // The existing `PageRegistry-XXX.cjs` shared chunk pattern from 6A's
      // build continues to work alongside this.
      output: {
        manualChunks(id) {
          if (id.includes('/src/hooks/')) return 'hooks';
          if (
            id.includes('/src/toolbar/icons') ||
            id.includes('/src/toolbar/labels') ||
            id.includes('/src/toolbar/composeHandlers') ||
            id.includes('/src/toolbar/useToolbarPart') ||
            id.includes('/src/toolbar/ToolbarShellContext')
          ) {
            return 'toolbar-shared';
          }
        },
      },
    },
    cssCodeSplit: false,
  },
});
