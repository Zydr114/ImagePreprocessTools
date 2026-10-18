import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [vue({ template: { compilerOptions: { isCustomElement: tag => tag.startsWith('mdui-') } } })],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
});
