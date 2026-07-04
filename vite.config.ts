import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// When CI=true (GitHub Actions), set the base path to the repo name so that
// asset URLs resolve correctly under GitHub Pages.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.CI ? '/gridfinity-expanded/' : '/',
  worker: {
    format: 'es',
  },
  // manifold-3d ships an Emscripten WASM loader; let it load the .wasm itself
  // rather than having esbuild pre-bundle (and break) it during dev.
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
});
