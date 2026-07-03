import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works whether it's deployed at a domain
// root (Vercel) or a GitHub Pages project subpath (/<repo>/).
export default defineConfig({
  base: './',
  plugins: [react()],
  // Without this, Vite's dependency scanner crawls every *.html in the repo,
  // including the archived legacy-3d-simulation/index.html (which references
  // "three" as a bare CDN import that isn't an npm dependency here).
  optimizeDeps: {
    entries: ['index.html'],
  },
});
