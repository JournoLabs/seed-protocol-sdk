import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ARWEAVE_HOST_ENV_KEYS } from '@seedprotocol/arweave'

// Each test loads fresh copies of query, eas and arweave, so the Base*Client statics start empty.
async function load(entry: 'browser' | 'node') {
  vi.resetModules()
  const eas = await import('@seedprotocol/eas')
  const arweave = await import('@seedprotocol/arweave')
  const query = entry === 'node' ? await import('../src/index.node') : await import('../src/index')
  return { eas, arweave, query }
}

/** Stand-ins for the clients SeedClient registers in a page. */
function registerHostClients({ eas, arweave }: Awaited<ReturnType<typeof load>>) {
  const graphql = { request: async () => ({}) }
  const queryClient = { fetchQuery: async () => undefined, getQueryData: () => undefined, removeQueries: async () => {} }
  eas.BaseEasClient.configure({ getEasClient: () => graphql } as never)
  eas.BaseQueryClient.configure({ getQueryClient: () => queryClient } as never)
  arweave.BaseArweaveClient.configure({} as never)
  arweave.BaseArweaveClient.applyProbedReadGateway('sdk-gateway.example')
  return { graphql, queryClient }
}

describe.each(['browser', 'node'] as const)('initializeQueryPlatform (%s entry)', (entry) => {
  beforeEach(() => {
    for (const key of ARWEAVE_HOST_ENV_KEYS) delete process.env[key]
  })

  it('uses clients and gateway already registered by the SDK', async () => {
    const loaded = await load(entry)
    const host = registerHostClients(loaded)

    await loaded.query.initializeQueryPlatform()

    expect(loaded.eas.BaseEasClient.getEasClient()).toBe(host.graphql)
    expect(loaded.eas.BaseQueryClient.getQueryClient()).toBe(host.queryClient)
    expect(loaded.arweave.BaseArweaveClient.getHost()).toBe('sdk-gateway.example')
  })

  it('an explicit arweaveDomain still sets the host', async () => {
    const loaded = await load(entry)
    registerHostClients(loaded)

    await loaded.query.initializeQueryPlatform({ arweaveDomain: 'explicit.example' })

    expect(loaded.arweave.BaseArweaveClient.getHost()).toBe('explicit.example')
  })

  it('registers default EAS clients when none are registered', async () => {
    const { eas, arweave, query } = await load(entry)

    await query.initializeQueryPlatform()

    expect(eas.BaseEasClient.getEasClient()).toBeDefined()
    expect(eas.BaseQueryClient.getQueryClient()).toBeDefined()
    expect(arweave.BaseArweaveClient.getHost()).toBe(arweave.DEFAULT_ARWEAVE_HOST)
  })
})

describe('Arweave client when none is registered', () => {
  it('the browser entry registers none (query only reads the host)', async () => {
    const { arweave, query } = await load('browser')
    await query.initializeQueryPlatform()
    expect(arweave.BaseArweaveClient.isConfigured()).toBe(false)
  })

  it('the Node entry registers the Node client', async () => {
    const { arweave, query } = await load('node')
    await query.initializeQueryPlatform()
    expect(arweave.BaseArweaveClient.isConfigured()).toBe(true)
  })
})
