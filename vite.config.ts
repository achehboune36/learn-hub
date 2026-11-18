import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // No manual chunking: mermaid and the course content are behind dynamic
    // imports, so Rollup's automatic splitting already keeps them out of the
    // initial load. Grouping them by hand only dragged their dependencies
    // (d3, katex) into the eager vendor chunk.
    chunkSizeWarningLimit: 900,
  },
});
