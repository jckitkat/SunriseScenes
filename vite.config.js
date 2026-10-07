import { defineConfig } from 'vite';

// base './' lets the built app in dist/ be opened from any folder or host path.
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
});
