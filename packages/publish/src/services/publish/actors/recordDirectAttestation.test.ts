import { beforeEach, describe, expect, mock, test } from 'bun:test'

const realConfig = await import('../../../config')
const realEasDirect = await import('../../../helpers/easDirect')

const recordPublishRequests = mock(async (_records: unknown[], _options: unknown) => {})
mock.module('@seedprotocol/sdk', () => ({ recordPublishRequests }))
mock.module('../../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({ easContractAddress: `0x${'e'.repeat(40)}` }),
}))
let attested: Array<{ schemaUid: string; uid: string }> = []
mock.module('../../../helpers/easDirect', () => ({
  ...realEasDirect,
  getAttestedUidsFromReceipt: () => attested,
}))
mock.module('../helpers/receiptAttestationMs', () => ({ attestationMsFromReceipt: async () => 1_700 }))

const { recordDirectAttestation } = await import('./recordDirectAttestation')

const ATTESTER = `0x${'b'.repeat(40)}`
const UID_A = `0x${'a'.repeat(64)}`
const UID_C = `0x${'c'.repeat(64)}`
const VERSION = `0x${'d'.repeat(64)}`
const ZERO = `0x${'0'.repeat(64)}`

const record = (step: 'seed' | 'version' | 'properties', target: Record<string, unknown>) =>
  recordDirectAttestation({
    step,
    target: { localId: 'post', ...target },
    receipt: {} as any,
    attester: ATTESTER,
    publisher: ATTESTER,
    attemptId: 'attempt1',
  })
const written = () => recordPublishRequests.mock.calls[0]!

beforeEach(() => {
  recordPublishRequests.mockClear()
  attested = [{ schemaUid: '0x1', uid: UID_A }]
})

describe('recordDirectAttestation', () => {
  test('a seed, in the same write as ending its attempt', async () => {
    const result = await record('seed', {})
    expect(result).toEqual({ uids: [UID_A], attestationMs: 1_700 })
    expect(written()).toEqual([
      [{ seed: { seedLocalId: 'post', seedUid: UID_A, publisher: ATTESTER, attestationCreatedAt: 1_700 } }],
      { attemptId: 'attempt1' },
    ])
  })

  test('a version, on the row it was built from', async () => {
    await record('version', { versionLocalId: 'v1' })
    expect(written()[0]).toEqual([
      {
        version: {
          seedLocalId: 'post',
          versionUid: UID_A,
          versionLocalId: 'v1',
          publisher: ATTESTER,
          attestationCreatedAt: 1_700,
        },
      },
    ])
  })

  test('properties, each on its row, with the seed uids they resolved', async () => {
    attested = [
      { schemaUid: '0x1', uid: UID_A },
      { schemaUid: '0x2', uid: UID_C },
    ]
    await record('properties', {
      versionUid: VERSION,
      resolvedSeedUids: { image: UID_C },
      properties: [{ _propertyName: 'title', _metadataLocalId: 'm1' }, { _attestedValue: 'tx1' }],
    })
    const [[{ properties }]] = written() as [[{ properties: any }], unknown]
    expect(properties).toMatchObject({ seedLocalId: 'post', versionUid: VERSION, resolvedSeedUids: { image: UID_C } })
    expect(properties.pairs[0]).toMatchObject({ attestationUid: UID_A, propertyName: 'title', metadataLocalId: 'm1' })
    expect(properties.pairs[1]).toMatchObject({ attestationUid: UID_C, value: 'tx1' })
  })

  test('a count that does not match the entries keeps the uids and names no rows', async () => {
    await record('properties', { versionUid: VERSION, properties: [] })
    const [[{ properties }]] = written() as [[{ properties: any }], unknown]
    expect(properties.pairs[0]).toMatchObject({ attestationUid: UID_A })
    expect(properties.pairs[0].metadataLocalId).toBeUndefined()
  })

  test('a zero version uid records no version', async () => {
    await record('properties', { versionUid: ZERO, properties: [{}] })
    const [[{ properties }]] = written() as [[{ properties: any }], unknown]
    expect(properties.versionUid).toBeNull()
  })

  test.each(['seed', 'version'] as const)('a %s receipt with no attestation throws, recording nothing', async (step) => {
    attested = []
    await expect(record(step, {})).rejects.toThrow('UID from attestation receipt')
    expect(recordPublishRequests).not.toHaveBeenCalled()
  })

  test('a failed write rejects', async () => {
    recordPublishRequests.mockImplementationOnce(async () => {
      throw new Error('disk full')
    })
    await expect(record('seed', {})).rejects.toThrow('disk full')
  })
})
