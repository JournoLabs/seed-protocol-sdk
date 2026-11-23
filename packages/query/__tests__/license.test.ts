import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attestation, LicenseOffer } from '@seedprotocol/eas'
import { createLicenseCatalog, termsHash } from '@seedprotocol/licensing'
import { creativeCommons } from '@seedprotocol/licensing/catalog/cc'

const fakeEas = vi.hoisted(() => ({
  seeds: [] as Attestation[],
  versions: [] as Attestation[],
  properties: [] as Attestation[],
  offers: [] as LicenseOffer[],
  offerReads: [] as Array<{ versionUids: readonly string[]; attester: string }>,
}))

vi.mock('@seedprotocol/eas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seedprotocol/eas')>()),
  getSeedsByUidsFromEas: async ({ uids }: { uids: string[] }) => fakeEas.seeds.filter((s) => uids.includes(s.id)),
  getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
    fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
  getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
    fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
  getLicenseOffersFromEas: async (args: { versionUids: readonly string[]; attester: string }) => {
    fakeEas.offerReads.push(args)
    return fakeEas.offers.filter(
      (o) => args.versionUids.includes(o.versionUid) && o.attester.toLowerCase() === args.attester.toLowerCase(),
    )
  },
}))

const initializeQueryPlatform = vi.hoisted(() => vi.fn(async (_options?: unknown) => {}))
vi.mock('../src/bootstrap.js', () => ({ initializeQueryPlatform }))

import { getLicense, getLicenseHistory } from '../src/license'

const catalog = createLicenseCatalog(creativeCommons)
const moduleTerms = (spdx: string) => termsHash(catalog.bySpdx(spdx)!.toTerms())
const CC_BY = moduleTerms('CC-BY-4.0')
const CC0 = moduleTerms('CC0-1.0')
const RESERVED = moduleTerms('LicenseRef-seed-all-rights-reserved-1')

const OWNER = '0x' + '1'.repeat(40)
const OTHER = '0x' + '2'.repeat(40)
const uid = (byte: string) => `0x${byte.repeat(32)}`
const SEED = uid('11')
const V1 = uid('12')
const V2 = uid('13')
const TITLE = uid('aa')

const attestation = (id: string, refUID: string, timeCreated: number, extra: Partial<Attestation> = {}): Attestation =>
  ({
    id,
    refUID,
    attester: OWNER,
    schemaId: uid('99'),
    timeCreated,
    revoked: false,
    revocationTime: 0,
    decodedDataJson: '',
    ...extra,
  }) as Attestation

const offer = (id: string, versionUid: string, timeCreated: number, hash: string, extra: Partial<LicenseOffer> = {}): LicenseOffer => ({
  uid: id,
  attester: OWNER,
  versionUid,
  timeCreated,
  revocationTime: 0,
  termsHash: hash,
  spdx: catalog.byTermsHash(hash)?.module.spdx ?? 'LicenseRef-unknown',
  ...extra,
})

beforeEach(() => {
  fakeEas.seeds = [attestation(SEED, '0x0', 100)]
  fakeEas.versions = [attestation(V1, SEED, 110)]
  fakeEas.properties = [attestation('title1', V1, 110, { schemaId: TITLE })]
  fakeEas.offers = []
  fakeEas.offerReads = []
})

describe('getLicense', () => {
  it('is null for a seed with no offer, and for a seed EAS does not have', async () => {
    expect(await getLicense({ seedUid: SEED })).toBeNull()
    expect(await getLicense({ seedUid: uid('ff') })).toBeNull()
  })

  it('resolves the offer in force through the catalog', async () => {
    fakeEas.offers = [offer('o1', V1, 110, CC_BY)]
    expect(await getLicense({ seedUid: SEED })).toEqual({
      spdx: 'CC-BY-4.0',
      iri: 'https://creativecommons.org/licenses/by/4.0/',
      termsHash: CC_BY,
      offerUid: 'o1',
      legalTxId: null,
      sentence: expect.stringContaining('credit'),
      revoked: false,
      since: 110,
    })
  })

  it('counts only offers from the seed attester, on any of its Versions', async () => {
    fakeEas.versions = [attestation(V1, SEED, 110), attestation(V2, SEED, 200)]
    fakeEas.properties.push(attestation('title2', V2, 200, { schemaId: TITLE }))
    fakeEas.offers = [offer('o1', V1, 150, CC0), offer('forged', V2, 160, CC_BY, { attester: OTHER })]
    expect((await getLicense({ seedUid: SEED }))?.offerUid).toBe('o1')
    expect(fakeEas.offerReads[0]).toEqual({ versionUids: [V1, V2], attester: OWNER })
  })

  it('does not let an offer made after the content govern it', async () => {
    fakeEas.offers = [offer('o1', V1, 110, CC_BY), offer('o2', V1, 300, RESERVED)]
    expect((await getLicense({ seedUid: SEED }))?.offerUid).toBe('o1')
    // A patch after the change shows newer content, which the newer offer governs.
    fakeEas.properties.push(attestation('title1b', V1, 400, { schemaId: TITLE }))
    expect((await getLicense({ seedUid: SEED }))?.offerUid).toBe('o2')
    // Pinned before the patch, the answer is the old one.
    expect((await getLicense({ seedUid: SEED, versionUid: V1, asOf: 350 }))?.offerUid).toBe('o1')
  })

  it('reads a revoked offer as reserved rights once content is attested after the revocation', async () => {
    fakeEas.offers = [offer('o1', V1, 110, CC_BY, { revocationTime: 200 })]
    expect((await getLicense({ seedUid: SEED }))?.revoked).toBe(false)
    fakeEas.properties.push(attestation('title1b', V1, 250, { schemaId: TITLE }))
    expect(await getLicense({ seedUid: SEED })).toMatchObject({
      spdx: 'LicenseRef-seed-all-rights-reserved-1',
      termsHash: RESERVED,
      offerUid: 'o1',
      revoked: true,
      since: 200,
    })
  })

  it('pins a Version: its own newest attestation as of asOf sets the time', async () => {
    fakeEas.versions = [attestation(V1, SEED, 110), attestation(V2, SEED, 200)]
    fakeEas.properties.push(attestation('title2', V2, 200, { schemaId: TITLE }))
    fakeEas.offers = [offer('o1', V1, 110, CC_BY), offer('o2', V2, 200, CC0)]
    expect((await getLicense({ seedUid: SEED, versionUid: V1 }))?.offerUid).toBe('o1')
    expect((await getLicense({ seedUid: SEED, versionUid: V2 }))?.offerUid).toBe('o2')
    expect((await getLicense({ seedUid: SEED, asOf: 150 }))?.offerUid).toBe('o1')
  })

  it('leaves out a property revoked by asOf', async () => {
    fakeEas.properties.push(attestation('title1b', V1, 300, { schemaId: TITLE, revoked: true, revocationTime: 320 }))
    fakeEas.offers = [offer('o1', V1, 110, CC_BY), offer('o2', V1, 300, CC0)]
    expect((await getLicense({ seedUid: SEED, asOf: 310 }))?.offerUid).toBe('o2')
    expect((await getLicense({ seedUid: SEED, asOf: 330 }))?.offerUid).toBe('o1')
  })

  it('is null for a Version that is not the seed attester’s', async () => {
    fakeEas.versions.push(attestation(V2, SEED, 200, { attester: OTHER }))
    fakeEas.offers = [offer('o1', V1, 110, CC_BY)]
    expect(await getLicense({ seedUid: SEED, versionUid: V2 })).toBeNull()
  })

  it('names the license by its SPDX id when the catalog does not know the terms', async () => {
    fakeEas.offers = [offer('o1', V1, 110, uid('cd'), { spdx: 'MIT', legalTxId: 'tx' })]
    expect(await getLicense({ seedUid: SEED })).toMatchObject({
      spdx: 'MIT',
      iri: null,
      sentence: null,
      legalTxId: 'tx',
    })
  })

  it('refuses a time that is not unix seconds', async () => {
    await expect(getLicense({ seedUid: SEED, asOf: Number.NaN })).rejects.toThrow(RangeError)
  })
})

describe('getLicenseHistory', () => {
  it('lists every change of the license, oldest first', async () => {
    fakeEas.offers = [offer('o2', V1, 300, CC0), offer('o1', V1, 110, CC_BY, { revocationTime: 200 })]
    const history = await getLicenseHistory(SEED)
    expect(history.map((l) => [l.offerUid, l.spdx, l.revoked, l.since])).toEqual([
      ['o1', 'CC-BY-4.0', false, 110],
      ['o1', 'LicenseRef-seed-all-rights-reserved-1', true, 200],
      ['o2', 'CC0-1.0', false, 300],
    ])
  })

  it('is empty for a seed EAS does not have', async () => {
    expect(await getLicenseHistory(uid('ff'))).toEqual([])
  })
})
