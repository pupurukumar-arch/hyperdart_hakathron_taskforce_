import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'demo',
  base: '/hyperdart_hakathron_taskforce_/',
  plugins: [react()],
  build: { outDir: '../dist-demo', emptyOutDir: true },
});
