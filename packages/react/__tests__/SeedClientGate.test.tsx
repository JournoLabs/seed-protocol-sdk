import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { SeedClientGate, SeedProvider } from '@seedprotocol/react'
import { client, BaseDb, schemas, Schema } from '@seedprotocol/sdk'
import type { SeedConstructorOptions, SchemaFileFormat } from '@seedprotocol/sdk'
import { eq } from 'drizzle-orm'

const initConfig: SeedConstructorOptions = {
  config: {
    endpoints: {
      filePaths: '/api/seed/migrations',
      files: '/app-files',
    },
    filesDir: '.seed',
  },
  addresses: [],
}

const testSchema: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'seedclientgate-test',
  metadata: {
    name: 'SeedClientGate Test Schema',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  models: {
    TestModel: {
      id: 'test-model-id',
      properties: {
        name: {
          id: 'name-prop-id',
          type: 'Text',
        },
      },
    },
  },
  enums: {},
  migrations: [],
}

const SeedProviderWrapper = ({ children }: { children: React.ReactNode }) => (
  <SeedProvider>{children}</SeedProvider>
)

describe('SeedClientGate', () => {
  let container: HTMLElement

  afterAll(async () => {
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(schemas).where(eq(schemas.name, 'SeedClientGate Test Schema'))
    }
    Schema.clearCache()
  })

  beforeEach(() => {
    container = document.createElement('div')
    container.id = 'root'
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('calls client.init with initConfig on mount', async () => {
    const sdk = await import('@seedprotocol/sdk')
    const initSpy = vi.spyOn(sdk.client, 'init')

    render(
      <SeedClientGate initConfig={initConfig}>
        <div data-testid="gated-content">App Content</div>
      </SeedClientGate>,
      { container, wrapper: SeedProviderWrapper }
    )

    expect(initSpy).toHaveBeenCalledWith(initConfig)
    initSpy.mockRestore()
  })

  it('passes an init failure to onInitError', async () => {
    const sdk = await import('@seedprotocol/sdk')
    const lockedError = new sdk.FileSystemLockedError(new DOMException('busy', 'InvalidStateError'))
    const initSpy = vi.spyOn(sdk.client, 'init').mockRejectedValueOnce(lockedError)
    const onInitError = vi.fn()

    render(
      <SeedClientGate initConfig={initConfig} onInitError={onInitError}>
        <div data-testid="gated-content">App Content</div>
      </SeedClientGate>,
      { container, wrapper: SeedProviderWrapper }
    )

    await waitFor(() => expect(onInitError).toHaveBeenCalledWith(lockedError))
    expect(onInitError.mock.calls[0][0].code).toBe('OPFS_LOCKED')
    initSpy.mockRestore()
  })

  it('shows children when client is ready', async () => {
    render(
      <SeedClientGate initConfig={initConfig}>
        <div data-testid="gated-content">App Content</div>
      </SeedClientGate>,
      { container, wrapper: SeedProviderWrapper }
    )

    await waitFor(
      () => {
        const content = screen.getByTestId('gated-content')
        expect(content).toBeTruthy()
        expect(content.textContent).toContain('App Content')
        expect(window.getComputedStyle(content.parentElement!).display).toBe('flex')
      },
      { timeout: 60000 }
    )
  })

  it('does not restart init when client.init is called again after ready', async () => {
    render(
      <SeedClientGate initConfig={initConfig}>
        <div data-testid="gated-content">App Content</div>
      </SeedClientGate>,
      { container, wrapper: SeedProviderWrapper }
    )

    await waitFor(
      () => {
        expect(client.isInitialized()).toBe(true)
      },
      { timeout: 60000 }
    )

    const before = client.getService().getSnapshot()
    await client.init(initConfig)
    const after = client.getService().getSnapshot()

    expect(after.value).toBe(before.value)
    expect(after.context.isInitialized).toBe(true)
    expect(after.context.initError).toBeUndefined()
  })

  it('renders custom loading component when provided', async () => {
    render(
      <SeedClientGate
        initConfig={initConfig}
        loadingComponent={<div data-testid="custom-loading">Custom Loading...</div>}
      >
        <div data-testid="gated-content">App Content</div>
      </SeedClientGate>,
      { container, wrapper: SeedProviderWrapper }
    )

    const customLoading = screen.getByTestId('custom-loading')
    expect(customLoading).toBeTruthy()
    expect(customLoading.textContent).toContain('Custom Loading...')
  })

  it('shows content when schema is provided and client becomes ready', async () => {
    render(
      <SeedClientGate initConfig={initConfig} schema={testSchema}>
        <div data-testid="gated-content">App Content</div>
      </SeedClientGate>,
      { container, wrapper: SeedProviderWrapper }
    )

    await waitFor(
      () => {
        const content = screen.getByTestId('gated-content')
        expect(content).toBeTruthy()
        expect(content.textContent).toContain('App Content')
        expect(window.getComputedStyle(content.parentElement!).display).toBe('flex')
      },
      { timeout: 60000 }
    )
  })
})
