import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// When CI=true (GitHub Actions), set the base path to the repo name so that
// asset URLs resolve correctly under GitHub Pages.
export default defineConfig({
  plugins: [react()],
  base: process.env.CI ? '/gridfinity-expanded/' : '/',
  worker: {
    format: 'es',
  },
});
