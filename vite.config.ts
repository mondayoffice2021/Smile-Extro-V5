import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Cloudflare Pages often serves the app as a static client-side asset.
  // This define ensures that any legacy process.env usage doesn't crash the browser.
  define: {
    'process.env': {}
  }
});
