import { defineConfig } from 'vite';
export default defineConfig({ base: '/pay/', build: { target: 'es2022', chunkSizeWarningLimit: 2000 } });
