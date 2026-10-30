'use client'

import { SeedClientGate } from '@seedprotocol/react'

const initConfig = {
  config: {
    endpoints: { filePaths: '/api/seed/migrations', files: '/app-files' },
    filesDir: '.seed',
  },
  addresses: [],
}

const schema = {
  $schema: 'https://seedprotocol.io/schemas/data-model/v1',
  version: 1,
  id: 'next-fixture',
  metadata: { name: 'Next Fixture', createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' },
  enums: {},
  migrations: [],
  models: {
    Note: { id: 'next-fixture-note', properties: { title: { id: 'next-fixture-note-title', type: 'Text' } } },
  },
}

export function Gate({ children }) {
  return (
    <SeedClientGate
      initConfig={initConfig}
      schema={schema}
      onInitError={(err) => {
        window.__seedInitError = String(err?.stack ?? err)
      }}
    >
      {children}
    </SeedClientGate>
  )
}
