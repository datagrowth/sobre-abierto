import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3110',
      '/auth': 'http://localhost:3110',
      '/hermes-vault': 'http://localhost:3110',
      '/socket.io': {
        target: 'http://localhost:3110',
        ws: true,
      },
      '/hermes-panel': {
        target: 'http://localhost:3110',
        ws: true,
      },
    },
  },
});
