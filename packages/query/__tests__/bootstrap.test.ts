import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ARWEAVE_HOST_ENV_KEYS } from '@seedprotocol/arweave'

// Each test loads fresh copies of query, eas and arweave, so the Base*Client statics start empty.
// Copies from earlier tests stay registered in the shared "which copy owns the clients" marker,
// so it is cleared too (`keepOwner` keeps it, to load a second copy beside a running one).
async function load(entry: 'browser' | 'node', { keepOwner = false } = {}) {
  vi.resetModules()
  const eas = await import('@seedprotocol/eas')
  const arweave = await import('@seedprotocol/arweave')
  if (!keepOwner) {
    eas.resetEasClientOwnerForTests()
    arweave.resetArweaveClientOwnerForTests()
  }
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

  it('keeps the models it was given until set again or torn down', async () => {
    const loaded = await load(entry)
    registerHostClients(loaded)
    const key = () => loaded.query.buildAssembleOptionsKey()
    const plain = key()
    await loaded.query.initializeQueryPlatform({
      models: { Post: { properties: { coAuthors: { type: 'List', ref: 'Identity' } } } },
    })
    const withModels = key()
    expect(withModels).not.toBe(plain)
    // Every query call initializes with only its source; the models stay
    await loaded.query.initializeQueryPlatform({ source: 'remote' })
    expect(key()).toBe(withModels)
    await loaded.query.initializeQueryPlatform({ models: null })
    expect(key()).toBe(plain)
    await loaded.query.initializeQueryPlatform({ models: { Post: { properties: { coAuthors: { type: 'List', ref: 'Identity' } } } } })
    await loaded.query.teardownQueryPlatform()
    expect(key()).toBe(plain)
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

describe('EAS client when none is registered', () => {
  it.each([
    ['node', 'NodeEasClient'],
    ['browser', 'DefaultEasClient'],
  ] as const)('the %s entry registers %s', async (entry, clientName) => {
    const { eas, query } = await load(entry)
    const configure = vi.spyOn(eas.BaseEasClient, 'configure')
    await query.initializeQueryPlatform()
    expect(configure.mock.calls.map(([impl]) => impl.constructor.name)).toContain(clientName)
    expect(configure.mock.calls.map(([impl]) => impl.constructor.name)).not.toContain(
      clientName === 'NodeEasClient' ? 'DefaultEasClient' : 'NodeEasClient',
    )
  })
})

describe('a second copy of eas / arweave', () => {
  it('throws when the SDK registered its clients on another copy of eas', async () => {
    const sdkCopy = await load('browser')
    registerHostClients(sdkCopy)
    const queryCopy = await load('browser', { keepOwner: true })

    await expect(queryCopy.query.initializeQueryPlatform()).rejects.toThrow(
      /Two copies of @seedprotocol\/eas/,
    )
  })

  it('throws on the next call when the SDK registers on another copy after query started', async () => {
    const queryCopy = await load('browser')
    await queryCopy.query.initializeQueryPlatform()
    const sdkCopy = await load('browser', { keepOwner: true })
    registerHostClients(sdkCopy)

    await expect(queryCopy.query.initializeQueryPlatform()).rejects.toThrow(
      /Two copies of @seedprotocol\/eas/,
    )
  })

  it('throws when only arweave is duplicated', async () => {
    const queryCopy = await load('node')
    const { arweave: otherArweave } = await load('node', { keepOwner: true })
    // Same eas copy as query; the Arweave client lands on the other arweave copy.
    queryCopy.eas.ensureEasPlatform()
    otherArweave.BaseArweaveClient.configure({} as never)

    await expect(queryCopy.query.initializeQueryPlatform()).rejects.toThrow(
      /Two copies of @seedprotocol\/arweave/,
    )
  })

  it("reads with source: 'local' when the SDK registered its clients on another copy", async () => {
    const sdkCopy = await load('browser')
    registerHostClients(sdkCopy)
    const queryCopy = await load('browser', { keepOwner: true })
    queryCopy.query.registerLocalQuerySource({
      kind: 'local',
      getSeedByUid: async () => null,
      getSeedsByUids: async () => [],
      getVersionsForSeeds: async () => [],
      getPropertiesForVersionUids: async () => [],
      listSeedsBySchemaName: async () => [],
      listSeedsBySchemaNameForMonth: async () => [],
    } as never)

    await expect(queryCopy.query.getSeed('0x' + 'ab'.repeat(32), { source: 'local' })).resolves.toBeNull()
    await expect(queryCopy.query.getSeeds(['0x' + 'ab'.repeat(32)], { source: 'local' })).resolves.toEqual(new Map())
    await expect(queryCopy.query.queryBySchema('post', { source: 'local' })).resolves.toMatchObject({ items: [] })
    await expect(queryCopy.query.getSeed('0x' + 'ab'.repeat(32))).rejects.toThrow(/Two copies of @seedprotocol/)
  })

  it('does not throw when the SDK and query share one copy', async () => {
    const loaded = await load('browser')
    registerHostClients(loaded)
    await loaded.query.initializeQueryPlatform()
    // Re-registering on the same copy (e.g. SeedClient restart) is fine.
    registerHostClients(loaded)
    await expect(loaded.query.initializeQueryPlatform()).resolves.toBeUndefined()
  })

})
