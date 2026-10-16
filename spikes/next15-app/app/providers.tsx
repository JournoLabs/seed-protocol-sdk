'use client'

import type { ReactNode } from 'react'
import { SeedProvider, SeedClientGate } from '@seedprotocol/react'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'

const initConfig: SeedConstructorOptions = {
  config: {
    endpoints: { filePaths: '/api/seed/migrations', files: '/app-files' },
    filesDir: '.seed',
  },
  addresses: [],
}

const schema: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'next-spike',
  metadata: { name: 'Next Spike', createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' },
  enums: {},
  migrations: [],
  models: {
    Note: { id: 'next-spike-note', properties: { title: { id: 'next-spike-note-title', type: 'Text' } } },
  },
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SeedProvider>
      <SeedClientGate
        initConfig={initConfig}
        schema={schema}
        onInitError={(err) => {
          console.error('[spike] init failed', err)
          ;(window as any).__spikeInitError = String((err as Error)?.stack ?? err)
        }}
      >
        {children}
      </SeedClientGate>
    </SeedProvider>
  )
}
