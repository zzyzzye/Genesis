import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    // 容器内限制并发，避免多个 jsdom 实例争抢资源导致交互用例超时。
    maxWorkers: 2,
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.ts',
  },
})
