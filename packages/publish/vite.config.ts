import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'thirdweb',
        'thirdweb/chains',
        'thirdweb/contract',
        'thirdweb/react',
        'thirdweb/utils',
        'thirdweb/wallets',
        'viem',
        '@seedprotocol/sdk',
        '@ethereum-attestation-service/eas-sdk',
      ],
    },
    sourcemap: true,
  },
})
