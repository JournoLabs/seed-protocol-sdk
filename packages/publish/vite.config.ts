import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
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
        '@seedprotocol/sdk',
        '@ethereum-attestation-service/eas-sdk',
      ],
    },
    sourcemap: true,
  },
})
