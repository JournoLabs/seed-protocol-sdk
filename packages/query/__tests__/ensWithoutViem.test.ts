import { describe, expect, it, vi } from 'vitest'

// viem is an optional peer: here it isn't installed.
const notInstalled = (specifier: string) =>
  Object.assign(new Error(`Cannot find package '${specifier}'`), { code: 'ERR_MODULE_NOT_FOUND' })
vi.mock('viem', () => {
  throw notInstalled('viem')
})
vi.mock('viem/actions', () => {
  throw notInstalled('viem')
})
vi.mock('viem/ens', () => {
  throw notInstalled('viem')
})

describe('@seedprotocol/query/ens without viem', () => {
  it('imports, and decodes contenthashes and publication records', async () => {
    const ens = await import('../src/ens/index')
    expect(ens.decodeContenthash('0x')).toBeNull()
    expect(ens.parseSeedPublicationRecord(JSON.stringify({ schema: 'Blog' })).schemaName).toBe('Blog')
  })

  it('rejects each ENS read with EnsViemMissingError', async () => {
    const { EnsViemMissingError, getEnsContenthash, getEnsNames, getSeedPublication } = await import('../src/ens/index')
    const client = {} as Parameters<typeof getEnsContenthash>[0]
    for (const read of [
      () => getEnsContenthash(client, { name: 'alice.eth' }),
      () => getSeedPublication(client, { name: 'alice.eth' }),
      () => getEnsNames(client, ['0x' + '1'.repeat(40)]),
    ]) {
      const err = await read().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(EnsViemMissingError)
      expect(err).toMatchObject({ code: 'ENS_VIEM_MISSING', name: 'EnsViemMissingError' })
    }
  })
})
