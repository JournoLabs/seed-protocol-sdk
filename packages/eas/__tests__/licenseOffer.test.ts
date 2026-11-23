import { describe, expect, it } from 'vitest'
import { arweaveTxIdToBytes32 } from '../src/archiveAnchor.js'
import { LICENSE_OFFER_SCHEMA_DEF, LICENSE_OFFER_SCHEMA_UID } from '../src/constants.js'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'
import { getLicenseOffersFromEas } from '../src/licenseOffer.js'
import { seedSchemaUid } from '../src/seedSchemaUid.js'

const TX = 'p1zjJ0gVyVyJtnHqO8pKcqQ4Ew3cZtYwYgC2QbE5xdA'
const ATTESTER = '0x' + 'aA'.repeat(20)
const TERMS = '0x' + 'ab'.repeat(32)
const ZERO32 = '0x' + '0'.repeat(64)

const field = (name: string, value: unknown) => ({ name, value: { name, value } })
const offer = (id: string, attester: string, timeCreated: number, extra: Record<string, unknown> = {}) => ({
  id,
  attester,
  refUID: '0x' + '01'.repeat(32),
  timeCreated,
  revocationTime: 0,
  revoked: false,
  decodedDataJson: JSON.stringify([
    field('terms_hash', TERMS),
    field('spdx', 'CC-BY-4.0'),
    field('legal_tx', ZERO32),
    field('price', { type: 'BigNumber', hex: '0x00' }),
  ]),
  ...extra,
})

function fakeEas(rows: unknown[]) {
  const wheres: any[] = []
  BaseEasClient.configure({
    getEasClient: () =>
      ({
        request: async (_doc: unknown, vars: { where: unknown }) => {
          wheres.push(vars.where)
          return { itemProperties: rows }
        },
      }) as never,
  })
  return wheres
}

describe('license offers', () => {
  it('has the UID of its definition', () => {
    expect(seedSchemaUid(LICENSE_OFFER_SCHEMA_DEF)).toBe(LICENSE_OFFER_SCHEMA_UID)
  })

  it("reads the attester's offers on the Versions, revoked ones included, oldest first", async () => {
    const wheres = fakeEas([
      offer('newer', ATTESTER.toLowerCase(), 2, { revoked: true, revocationTime: 5 }),
      offer('older', ATTESTER, 1),
      offer('forged', '0x' + 'bb'.repeat(20), 3),
      { ...offer('broken', ATTESTER, 4), decodedDataJson: 'not json' },
    ])
    const offers = await getLicenseOffersFromEas({ versionUids: ['0xAB', '0x01'], attester: ATTESTER })
    expect(offers.map((o) => o.uid)).toEqual(['older', 'newer'])
    expect(offers[0]).toEqual({
      uid: 'older',
      attester: ATTESTER,
      versionUid: '0x' + '01'.repeat(32),
      timeCreated: 1,
      revocationTime: 0,
      termsHash: TERMS,
      spdx: 'CC-BY-4.0',
    })
    expect(offers[1]!.revocationTime).toBe(5)
    expect(wheres[0]).toEqual({ refUID: { in: ['0x01', '0xab'] }, schemaId: { equals: LICENSE_OFFER_SCHEMA_UID } })
  })

  it('gives the legal text transaction id when the offer names one', async () => {
    const row = offer('a', ATTESTER, 1)
    row.decodedDataJson = row.decodedDataJson.replace(ZERO32, arweaveTxIdToBytes32(TX))
    fakeEas([row])
    const [read] = await getLicenseOffersFromEas({ versionUids: ['0x01'], attester: ATTESTER })
    expect(read!.legalTxId).toBe(TX)
  })

  it('skips an offer whose terms hash is not bytes32 or whose spdx is empty', async () => {
    const badHash = offer('a', ATTESTER, 1)
    badHash.decodedDataJson = badHash.decodedDataJson.replace(TERMS, '0x12')
    const noSpdx = offer('b', ATTESTER, 1)
    noSpdx.decodedDataJson = noSpdx.decodedDataJson.replace('CC-BY-4.0', '')
    fakeEas([badHash, noSpdx])
    expect(await getLicenseOffersFromEas({ versionUids: ['0x01'], attester: ATTESTER })).toEqual([])
  })

  it('makes no request without Versions', async () => {
    const wheres = fakeEas([])
    expect(await getLicenseOffersFromEas({ versionUids: [], attester: ATTESTER })).toEqual([])
    expect(wheres).toHaveLength(0)
  })
})
