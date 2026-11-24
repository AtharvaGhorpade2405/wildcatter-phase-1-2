import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Builds the React app into ../dist-web, which Express (and therefore Electron) serves.
// `npm run dev` runs Vite with hot reload and proxies /api to the Express server on :4600.
export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: { outDir: '../dist-web', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4600' } },
});
