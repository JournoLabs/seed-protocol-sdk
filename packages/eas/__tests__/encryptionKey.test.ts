import { describe, expect, it } from 'vitest'
import { arweaveTxIdToBytes32 } from '../src/archiveAnchor.js'
import { ENCRYPTION_KEY_SCHEMA_UID } from '../src/constants.js'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'
import { getEncryptionKeysFromEas } from '../src/encryptionKey.js'
import { checksumAddresses } from '../src/utils.js'

const TX = 'p1zjJ0gVyVyJtnHqO8pKcqQ4Ew3cZtYwYgC2QbE5xdA'
const ATTESTER = '0x' + 'aA'.repeat(20)
const KEY_ID = '0x' + 'cd'.repeat(32)

const field = (name: string, value: unknown) => ({ name, value: { name, value } })
const registration = (id: string, attester: string, timeCreated: number, revocationTime = 0) => ({
  id,
  attester,
  timeCreated,
  revocationTime,
  decodedDataJson: JSON.stringify([
    field('key_id', KEY_ID),
    field('suite', 'seed-private/v1'),
    field('recipient_key', '0x' + '11'.repeat(1216)),
    field('tag_key', '0x' + '22'.repeat(32)),
    field('binding_key', '0x' + '33'.repeat(32)),
    field('binding_signature', '0x' + '44'.repeat(64)),
    field('keystore_tx', arweaveTxIdToBytes32(TX)),
  ]),
})

function answer(itemProperties: unknown[]) {
  const calls: any[] = []
  BaseEasClient.configure({
    getEasClient: () =>
      ({
        request: async (_doc: unknown, vars: { where: unknown }) => {
          calls.push(vars.where)
          return { itemProperties }
        },
      }) as never,
  })
  return calls
}

describe('encryption key registrations', () => {
  it("reads the account's live registrations, newest first, and skips other attesters and what doesn't decode", async () => {
    const calls = answer([
      registration('older', ATTESTER, 1),
      registration('newer', ATTESTER.toLowerCase(), 2),
      registration('forged', '0x' + 'bb'.repeat(20), 3),
      { ...registration('broken', ATTESTER, 4), decodedDataJson: 'not json' },
      {
        ...registration('no key', ATTESTER, 5),
        decodedDataJson: JSON.stringify([field('key_id', KEY_ID), field('suite', 'seed-private/v1'), field('recipient_key', '0x')]),
      },
    ])
    const keys = await getEncryptionKeysFromEas({ attester: ATTESTER })
    expect(keys.map((k) => k.uid)).toEqual(['newer', 'older'])
    expect(keys[0]).toMatchObject({ keyId: KEY_ID, suite: 'seed-private/v1', keystoreTx: TX, revocationTime: 0 })
    expect(keys[0]!.recipientKey).toEqual(new Uint8Array(1216).fill(0x11))
    expect(keys[0]!.tagKey).toEqual(new Uint8Array(32).fill(0x22))
    expect(keys[0]!.bindingKey).toEqual(new Uint8Array(32).fill(0x33))
    expect(keys[0]!.bindingSignature).toEqual(new Uint8Array(64).fill(0x44))
    expect(calls[0]).toMatchObject({
      attester: { equals: checksumAddresses([ATTESTER])[0] },
      schemaId: { equals: ENCRYPTION_KEY_SCHEMA_UID },
      AND: [{ revoked: { equals: false } }],
    })
  })

  it('orders registrations from the same second by uid, whatever order the indexer returns', async () => {
    const a = registration('0x' + 'aa'.repeat(32), ATTESTER, 7)
    const b = registration('0x' + 'bb'.repeat(32), ATTESTER, 7)
    answer([a, b])
    const first = await getEncryptionKeysFromEas({ attester: ATTESTER })
    answer([b, a])
    const second = await getEncryptionKeysFromEas({ attester: ATTESTER })
    expect(first.map((k) => k.uid)).toEqual([b.id, a.id])
    expect(second.map((k) => k.uid)).toEqual([b.id, a.id])
  })

  it('asks for revoked registrations too when told to', async () => {
    const calls = answer([registration('revoked', ATTESTER, 1, 9)])
    const keys = await getEncryptionKeysFromEas({ attester: ATTESTER, includeRevoked: true })
    expect(keys[0]!.revocationTime).toBe(9)
    expect(calls[0].AND).toBeUndefined()
  })
})
