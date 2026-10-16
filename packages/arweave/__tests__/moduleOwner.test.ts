import { afterEach, describe, expect, it, vi } from 'vitest'

// Fresh module copies stand in for a second install of @seedprotocol/arweave in one page.
async function loadCopy() {
  vi.resetModules()
  return import('../src/index.js')
}

describe('assertSingleArweaveModule', () => {
  afterEach(async () => {
    ;(await import('../src/index.js')).resetArweaveClientOwnerForTests()
  })

  it('passes when the client was registered on this copy', async () => {
    const arweave = await loadCopy()
    arweave.resetArweaveClientOwnerForTests()
    expect(() => arweave.assertSingleArweaveModule()).not.toThrow()
    arweave.BaseArweaveClient.configure({} as never)
    expect(() => arweave.assertSingleArweaveModule()).not.toThrow()
  })

  it('throws when another copy registered the client', async () => {
    const first = await loadCopy()
    first.resetArweaveClientOwnerForTests()
    const second = await loadCopy()
    second.BaseArweaveClient.configure({} as never)

    expect(() => first.assertSingleArweaveModule()).toThrow(first.DuplicateArweaveModuleError)
    expect(() => second.assertSingleArweaveModule()).not.toThrow()
  })
})
