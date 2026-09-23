import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // strictPort so the app never silently drifts to a different port: start.bat
  // and stop.bat both address it by number.
  server: { port: 15455, strictPort: true, open: false },
  preview: { port: 15455, strictPort: true, open: false },
  build: {
    // Cytoscape and Recharts dominate the bundle and change far less often than
    // the application code, so they are split out to keep the app chunk small
    // and cacheable.
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('cytoscape')) return 'cytoscape';
          // The 3D stack is the largest dependency by far and is only needed
          // when the Network Map is opened in 3D, so it is kept separate and
          // loaded on demand.
          if (
            id.includes('/three/') ||
            id.includes('@react-three') ||
            id.includes('postprocessing') ||
            id.includes('troika') ||
            id.includes('d3-force-3d') ||
            id.includes('n8ao') ||
            id.includes('meshline') ||
            id.includes('maath')
          ) {
            return 'three';
          }
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'charts';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react';
          return undefined;
        },
      },
    },
    // three.js is irreducibly large, but it lives in its own chunk that is
    // only fetched when the Network Map is opened in 3D.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
