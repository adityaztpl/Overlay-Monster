import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'electron' ? './' : '/',
  build: {
    outDir: mode === 'web' ? 'dist' : 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
}));
