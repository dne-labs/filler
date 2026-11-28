import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: '127.0.0.1' },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils|gsap|lenis)[\\/]/.test(id)) return 'vendor-motion';
          if (id.includes('/node_modules/lucide-react/')) return 'vendor-icons';
        },
      },
    },
  },
});
