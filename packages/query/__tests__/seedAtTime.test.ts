import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attestation } from '@seedprotocol/eas'

const fakeEas = vi.hoisted(() => ({
  seeds: [] as Attestation[],
  versions: [] as Attestation[],
  properties: [] as Attestation[],
}))

vi.mock('@seedprotocol/eas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seedprotocol/eas')>()),
  getSeedsByUidsFromEas: async ({ uids }: { uids: string[] }) => fakeEas.seeds.filter((s) => uids.includes(s.id)),
  getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
    fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
  getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
    fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
}))

const initializeQueryPlatform = vi.hoisted(() => vi.fn(async (_options?: unknown) => {}))
vi.mock('../src/bootstrap.js', () => ({ initializeQueryPlatform }))

import { readSeedAtTime } from '../src/seedAtTime'

const OWNER = '0x' + '1'.repeat(40)
const OTHER = '0x' + '2'.repeat(40)
const uid = (byte: string) => `0x${byte.repeat(32)}`
const SEED = uid('11')
const V1 = uid('12')
const V2 = uid('13')
const TITLE_SCHEMA = uid('aa')
const SUMMARY_SCHEMA = uid('ab')

const attestation = (
  id: string,
  refUID: string,
  timeCreated: number,
  extra: Partial<Attestation> = {},
): Attestation =>
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

const property = (id: string, version: string, schemaId: string, timeCreated: number, extra: Partial<Attestation> = {}) =>
  attestation(id, version, timeCreated, { schemaId, ...extra })

const ids = (attestations: Attestation[]) => attestations.map((a) => a.id).sort()

beforeEach(() => {
  fakeEas.seeds = [attestation(SEED, '0x0', 100)]
  fakeEas.versions = [attestation(V1, SEED, 110)]
  fakeEas.properties = []
})

describe('readSeedAtTime', () => {
  // Batch 16 item 48: as getSeedAttestations({ asOf }) reads
  describe('agrees with getSeedAttestations({ asOf })', () => {
    it('reads a uid in any case', async () => {
      const lettered = uid('ab')
      fakeEas.seeds = [attestation(lettered, '0x0', 100)]
      fakeEas.versions = [attestation(V1, lettered, 110)]
      expect((await readSeedAtTime(lettered.toUpperCase().replace('0X', '0x')))?.version?.id).toBe(V1)
    })

    it('refuses a time that is not unix seconds', async () => {
      await expect(readSeedAtTime(SEED, Number.NaN)).rejects.toThrow(RangeError)
      await expect(readSeedAtTime(SEED, Number.POSITIVE_INFINITY)).rejects.toThrow(RangeError)
    })

    it('is undefined before the seed was created', async () => {
      expect(await readSeedAtTime(SEED, 99)).toBeUndefined()
    })

    it('lists only the Versions made by asOf', async () => {
      fakeEas.versions = [attestation(V1, SEED, 110), attestation(V2, SEED, 200)]
      expect((await readSeedAtTime(SEED, 150))!.versions.map((v) => v.id)).toEqual([V1])
      expect((await readSeedAtTime(SEED))!.versions.map((v) => v.id)).toEqual([V1, V2])
    })

    it('starts the query platform for EAS, with its one-copy check', async () => {
      initializeQueryPlatform.mockClear()
      await readSeedAtTime(SEED)
      expect(initializeQueryPlatform).toHaveBeenCalledWith({ source: 'remote' })
    })
  })

  it('is undefined for a seed EAS does not have', async () => {
    expect(await readSeedAtTime(uid('77'))).toBeUndefined()
  })

  it('takes the newest attestation per property schema made by asOf', async () => {
    fakeEas.properties = [
      property(uid('21'), V1, TITLE_SCHEMA, 120),
      property(uid('22'), V1, TITLE_SCHEMA, 130),
      property(uid('23'), V1, TITLE_SCHEMA, 150),
      property(uid('24'), V1, SUMMARY_SCHEMA, 125),
    ]
    const state = await readSeedAtTime(SEED, 140)
    expect(state?.version?.id).toBe(V1)
    expect(state?.asOf).toBe(140)
    expect(ids(state!.properties)).toEqual([uid('22'), uid('24')])
    expect(state!.allProperties).toHaveLength(4)
  })

  it('counts a revocation only once it happened by asOf', async () => {
    fakeEas.properties = [
      property(uid('21'), V1, TITLE_SCHEMA, 120),
      property(uid('22'), V1, TITLE_SCHEMA, 130, { revoked: true, revocationTime: 160 }),
    ]
    const before = await readSeedAtTime(SEED, 150)
    expect(before!.properties.map((p) => [p.id, p.revoked])).toEqual([[uid('22'), false]])
    const after = await readSeedAtTime(SEED, 170)
    expect(after!.properties.map((p) => [p.id, p.revoked])).toEqual([[uid('21'), false]])
  })

  it('keeps the newest revoked attestation as a retraction when none is live', async () => {
    fakeEas.properties = [
      property(uid('21'), V1, TITLE_SCHEMA, 120, { revoked: true, revocationTime: 125 }),
      property(uid('22'), V1, TITLE_SCHEMA, 130, { revoked: true, revocationTime: 135 }),
    ]
    const state = await readSeedAtTime(SEED, 140)
    expect(state!.properties.map((p) => [p.id, p.revoked])).toEqual([[uid('22'), true]])
  })

  it("reads only the seed attester's Versions and the Version attester's properties", async () => {
    fakeEas.versions.push(attestation(V2, SEED, 140, { attester: OTHER }))
    fakeEas.properties = [
      property(uid('21'), V1, TITLE_SCHEMA, 120),
      property(uid('22'), V1, TITLE_SCHEMA, 130, { attester: OTHER }),
    ]
    const state = await readSeedAtTime(SEED, 150)
    expect(state?.version?.id).toBe(V1)
    expect(state!.versions.map((v) => v.id)).toEqual([V1])
    expect(ids(state!.properties)).toEqual([uid('21')])
    expect(ids(state!.allProperties)).toEqual([uid('21')])
  })

  it('falls back to the previous Version when the newest was revoked by asOf', async () => {
    fakeEas.versions.push(attestation(V2, SEED, 140, { revoked: true, revocationTime: 145 }))
    expect((await readSeedAtTime(SEED, 142))?.version?.id).toBe(V2)
    expect((await readSeedAtTime(SEED, 150))?.version?.id).toBe(V1)
  })

  it('has no Version before the first one', async () => {
    const state = await readSeedAtTime(SEED, 105)
    expect(state?.version).toBeUndefined()
    expect(state?.properties).toEqual([])
  })

  it('defaults asOf to the last attestation or revocation on the Version', async () => {
    fakeEas.properties = [
      property(uid('21'), V1, TITLE_SCHEMA, 120),
      property(uid('22'), V1, SUMMARY_SCHEMA, 130, { revoked: true, revocationTime: 170 }),
    ]
    const state = await readSeedAtTime(SEED)
    expect(state?.asOf).toBe(170)
    expect(state!.properties.map((p) => [p.id, p.revoked])).toEqual([
      [uid('21'), false],
      [uid('22'), true],
    ])
  })
})
