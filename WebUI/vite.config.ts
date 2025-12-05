import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8081',
        ws: true,
      },
      '/debug-bridge': {
        target: 'ws://localhost:8081',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // 将 protobufjs 分离成独立 chunk
          protobuf: ['protobufjs'],
          // 将 react 相关依赖分离
          vendor: ['react', 'react-dom', 'react-router-dom'],
          // 将状态管理分离
          zustand: ['zustand'],
        },
      },
    },
  },
})

