import { afterEach, describe, expect, mock, test } from 'bun:test'
import { createActor, toPromise } from 'xstate'

const SEED_UID = `0x${'11'.repeat(32)}`
const COVER = `0x${'21'.repeat(32)}`
const COVER_SCHEMA = `0x${'31'.repeat(32)}`

const state = {
  retractions: [] as { propertyName: string; attestations: { uid: string; schemaUid: string }[] }[],
  revoked: null as null | { seedLocalId: string; seedUid: string; attestations: { uid: string; schemaUid: string }[] },
  revokeError: null as Error | null,
}

const sdkActual = await import('@seedprotocol/sdk')
mock.module('@seedprotocol/sdk', () => ({
  ...sdkActual,
  getPendingRetractions: async () => state.retractions,
}))

mock.module('../../revoke/revokeAttestations', () => ({
  revokePropertyAttestations: async (params: NonNullable<typeof state.revoked>) => {
    if (state.revokeError) throw state.revokeError
    state.revoked = params
  },
}))

const { revokeRetractedProperties } = await import('./revokeRetractedProperties')

const run = (item: { seedLocalId?: string; seedUid?: string }) =>
  toPromise(createActor(revokeRetractedProperties, { input: { context: { item } as never } }).start())

afterEach(() => {
  state.retractions = []
  state.revoked = null
  state.revokeError = null
})

describe('revokeRetractedProperties (ADR 0021)', () => {
  test('revokes the attestations of every retracted property', async () => {
    state.retractions = [{ propertyName: 'coverImageId', attestations: [{ uid: COVER, schemaUid: COVER_SCHEMA }] }]
    await run({ seedLocalId: 'seed1', seedUid: SEED_UID })
    expect(state.revoked).toEqual({
      seedLocalId: 'seed1',
      seedUid: SEED_UID,
      attestations: [{ uid: COVER, schemaUid: COVER_SCHEMA }],
    })
  })

  test('does nothing without retractions, or for an unpublished item', async () => {
    await run({ seedLocalId: 'seed1', seedUid: SEED_UID })
    state.retractions = [{ propertyName: 'coverImageId', attestations: [{ uid: COVER, schemaUid: COVER_SCHEMA }] }]
    await run({ seedLocalId: 'seed1' })
    expect(state.revoked).toBeNull()
  })

  test('fails when the revocation fails, so the publish can retry it', async () => {
    state.retractions = [{ propertyName: 'coverImageId', attestations: [{ uid: COVER, schemaUid: COVER_SCHEMA }] }]
    state.revokeError = new Error('user rejected')
    await expect(run({ seedLocalId: 'seed1', seedUid: SEED_UID })).rejects.toThrow('user rejected')
  })
})
