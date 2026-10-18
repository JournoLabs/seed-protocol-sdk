import { describe, expect, it, vi } from 'vitest'

// Fresh modules per test so BaseEasClient / BaseQueryClient start unconfigured.
async function load() {
  vi.resetModules()
  return import('../src/index.js')
}

describe('ensureEasPlatform', () => {
  it('registers the default clients when none are registered', async () => {
    const eas = await load()
    expect(eas.BaseEasClient.isConfigured()).toBe(false)
    expect(eas.BaseQueryClient.isConfigured()).toBe(false)

    eas.ensureEasPlatform()

    expect(eas.BaseEasClient.isConfigured()).toBe(true)
    expect(eas.BaseQueryClient.isConfigured()).toBe(true)
  })

  it('keeps clients a host already registered and fills in only the missing one', async () => {
    const eas = await load()
    const graphql = {}
    eas.BaseEasClient.configure({ getEasClient: () => graphql } as never)

    eas.ensureEasPlatform()

    expect(eas.BaseEasClient.getEasClient()).toBe(graphql)
    expect(eas.BaseQueryClient.isConfigured()).toBe(true)
  })

  it('does not register anything when loaded', async () => {
    const eas = await load()
    await import('../src/default/index.js')
    expect(eas.BaseEasClient.isConfigured()).toBe(false)
  })
})
