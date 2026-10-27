import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    cssMinify: false,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/proxy': {
        target: 'http://127.0.0.1:8000',
        ws: true,
      },
    },
  },
});
