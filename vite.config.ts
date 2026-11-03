import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['index.html'] },
  server: { host: '0.0.0.0', port: 5174 },
  preview: { host: '0.0.0.0', port: 4174 },
});
