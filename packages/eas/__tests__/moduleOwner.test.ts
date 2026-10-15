import { afterEach, describe, expect, it, vi } from 'vitest'

// Fresh module copies stand in for a second install of @seedprotocol/eas in one page.
async function loadCopy() {
  vi.resetModules()
  return import('../src/index.js')
}

describe('assertSingleEasModule', () => {
  afterEach(async () => {
    ;(await import('../src/index.js')).resetEasClientOwnerForTests()
  })

  it('passes before any client is registered, and after one registered on this copy', async () => {
    const eas = await loadCopy()
    eas.resetEasClientOwnerForTests()
    expect(() => eas.assertSingleEasModule()).not.toThrow()
    eas.ensureEasPlatform()
    expect(() => eas.assertSingleEasModule()).not.toThrow()
  })

  it('throws when another copy registered a client', async () => {
    const first = await loadCopy()
    first.resetEasClientOwnerForTests()
    const second = await loadCopy()
    second.BaseQueryClient.configure({ getQueryClient: () => ({}) } as never)

    expect(() => first.assertSingleEasModule()).toThrow(first.DuplicateEasModuleError)
    expect(() => second.assertSingleEasModule()).not.toThrow()
  })
})
