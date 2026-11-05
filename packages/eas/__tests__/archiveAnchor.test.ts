import { describe, expect, it } from 'vitest'
import { arweaveTxIdToBytes32, bytes32ToArweaveTxId, getArchiveAnchorsFromEas } from '../src/archiveAnchor.js'
import { ARCHIVE_ANCHOR_SCHEMA_UID } from '../src/constants.js'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'

const TX = 'p1zjJ0gVyVyJtnHqO8pKcqQ4Ew3cZtYwYgC2QbE5xdA'
const ATTESTER = '0x' + 'aA'.repeat(20)
const HASH = 'ab'.repeat(32)

const field = (name: string, value: unknown) => ({ name, value: { name, value } })
const anchor = (id: string, attester: string, timeCreated: number, coveredUntil: unknown = { type: 'BigNumber', hex: '0x64' }) => ({
  id,
  attester,
  timeCreated,
  decodedDataJson: JSON.stringify([
    field('covered_until', coveredUntil),
    field('manifest_tx', arweaveTxIdToBytes32(TX)),
    field('tagmanifest_sha256', `0x${HASH}`),
  ]),
})

describe('archive anchors', () => {
  it('turns a transaction id into bytes32 and back', () => {
    expect(arweaveTxIdToBytes32(TX)).toMatch(/^0x[0-9a-f]{64}$/)
    expect(bytes32ToArweaveTxId(arweaveTxIdToBytes32(TX))).toBe(TX)
    expect(() => arweaveTxIdToBytes32('short')).toThrow()
    // 43 characters, but the last one's low bits are set: it isn't 32 bytes.
    expect(() => arweaveTxIdToBytes32('x'.repeat(43))).toThrow()
  })

  it("reads the attester's live anchors, newest first, and skips what doesn't decode", async () => {
    let where: any
    BaseEasClient.configure({
      getEasClient: () =>
        ({
          request: async (_doc: unknown, vars: { where: unknown }) => {
            where = vars.where
            return {
              itemProperties: [
                anchor('older', ATTESTER, 1),
                anchor('newer', ATTESTER.toLowerCase(), 2),
                anchor('forged', '0x' + 'bb'.repeat(20), 3),
                { ...anchor('broken', ATTESTER, 4), decodedDataJson: 'not json' },
              ],
            }
          },
        }) as never,
    })
    const anchors = await getArchiveAnchorsFromEas({ versionUid: '0x01', attester: ATTESTER })
    expect(anchors.map((a) => a.uid)).toEqual(['newer', 'older'])
    expect(anchors[0]).toMatchObject({ coveredUntil: 100, manifestTx: TX, tagmanifestSha256: HASH })
    expect(where).toMatchObject({
      refUID: { equals: '0x01' },
      schemaId: { equals: ARCHIVE_ANCHOR_SCHEMA_UID },
      AND: [{ revoked: { equals: false } }],
    })
  })

  // Batch 16 item 49
  it('asks with a lower-case Version uid', async () => {
    let where: any
    BaseEasClient.configure({
      getEasClient: () =>
        ({
          request: async (_doc: unknown, vars: { where: unknown }) => {
            where = vars.where
            return { itemProperties: [] }
          },
        }) as never,
    })
    const upper = '0x' + 'AB'.repeat(32)
    await getArchiveAnchorsFromEas({ versionUid: upper, attester: ATTESTER })
    expect(where.refUID).toEqual({ equals: upper.toLowerCase() })
  })
})
