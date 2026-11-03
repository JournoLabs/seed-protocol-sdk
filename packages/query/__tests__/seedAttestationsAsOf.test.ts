import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attestation } from '@seedprotocol/eas'

const fakeEas = vi.hoisted(() => ({
  seeds: [] as Attestation[],
  versions: [] as Attestation[],
  properties: [] as Attestation[],
}))

vi.mock('../src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

// EAS as it is now: revoked attestations come back marked, with their revocation time.
vi.mock('@seedprotocol/eas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seedprotocol/eas')>()),
  getSeedsByUidsFromEas: async ({ uids }: { uids: string[] }) => fakeEas.seeds.filter((s) => uids.includes(s.id)),
  getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
    fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
  getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
    fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
}))

import { getSeedAttestations, readSeedAtTime } from '../src/index'

const OWNER = '0x' + '1'.repeat(40)
const OTHER = '0x' + '2'.repeat(40)
const uid = (byte: string) => `0x${byte.repeat(32)}`
const SEED = uid('11')
const V1 = uid('12')
const V2 = uid('13')

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

const revokedAt = (time: number): Partial<Attestation> => ({ revoked: true, revocationTime: time })

const property = (id: string, version: string, name: string, value: string, timeCreated: number, extra: Partial<Attestation> = {}) =>
  attestation(id, version, timeCreated, {
    schemaId: uid(name === 'title' ? 'aa' : 'ab'),
    decodedDataJson: JSON.stringify([{ value: { name, type: 'string', value } }]),
    ...extra,
  })

const valuesAt = async (asOf?: number) => {
  const entry = (await getSeedAttestations([SEED], { asOf })).get(SEED)
  if (!entry) return undefined
  return Object.fromEntries(entry.properties.map((p) => [p.easName, p.value]))
}

beforeEach(() => {
  fakeEas.seeds = [attestation(SEED, '0x0', 100, { schema: { schemaNames: [{ name: 'post' }] } } as Partial<Attestation>)]
  fakeEas.versions = [attestation(V1, SEED, 110)]
  fakeEas.properties = []
})

describe('getSeedAttestations with asOf', () => {
  it('leaves out a patch made after asOf', async () => {
    fakeEas.properties = [property(uid('21'), V1, 'title', 'First', 120), property(uid('22'), V1, 'title', 'Patched', 150)]
    expect(await valuesAt(130)).toEqual({ title: 'First' })
    expect(await valuesAt(150)).toEqual({ title: 'Patched' })
    const entry = (await getSeedAttestations([SEED], { asOf: 130 })).get(SEED)!
    expect(entry.record.data.title).toBe('First')
  })

  it('keeps a value revoked after asOf and drops one revoked by then', async () => {
    fakeEas.properties = [
      property(uid('21'), V1, 'title', 'Kept then', 120, revokedAt(200)),
      property(uid('22'), V1, 'summary', 'Retracted', 120, revokedAt(140)),
    ]
    expect(await valuesAt(150)).toEqual({ title: 'Kept then' })
    expect(await valuesAt(250)).toEqual({})
  })

  it('reads the Version live at asOf, and its history up to it', async () => {
    fakeEas.versions = [attestation(V1, SEED, 110), attestation(V2, SEED, 300)]
    fakeEas.properties = [property(uid('21'), V1, 'title', 'One', 120), property(uid('22'), V2, 'title', 'Two', 310)]
    const before = (await getSeedAttestations([SEED], { asOf: 200 })).get(SEED)!
    expect(before.record.versionUid).toBe(V1)
    expect(before.versions.map((v) => v.attestationUid)).toEqual([V1])
    const after = (await getSeedAttestations([SEED], { asOf: 400 })).get(SEED)!
    expect(after.record.versionUid).toBe(V2)
    expect(after.versions).toEqual([
      { attestationUid: V1, attester: OWNER, timeCreated: 110 },
      { attestationUid: V2, attester: OWNER, timeCreated: 300 },
    ])
  })

  it('falls back from a Version revoked by asOf, and leaves revoked and foreign Versions out of the history', async () => {
    fakeEas.versions = [
      attestation(V1, SEED, 110),
      attestation(V2, SEED, 300, revokedAt(350)),
      attestation(uid('14'), SEED, 320, { attester: OTHER }),
    ]
    fakeEas.properties = [property(uid('21'), V1, 'title', 'One', 120), property(uid('22'), V2, 'title', 'Two', 310)]
    expect((await getSeedAttestations([SEED], { asOf: 340 })).get(SEED)!.record.versionUid).toBe(V2)
    const later = (await getSeedAttestations([SEED], { asOf: 400 })).get(SEED)!
    expect(later.record.versionUid).toBe(V1)
    expect(later.versions.map((v) => v.attestationUid)).toEqual([V1])
  })

  it('leaves out a seed with no Version by asOf', async () => {
    expect(await valuesAt(105)).toBeUndefined()
  })

  it("picks the same attestations as readSeedAtTime", async () => {
    fakeEas.versions = [attestation(V1, SEED, 110), attestation(V2, SEED, 300, revokedAt(500))]
    fakeEas.properties = [
      property(uid('21'), V1, 'title', 'One', 120),
      property(uid('22'), V2, 'title', 'Two', 310, revokedAt(330)),
      property(uid('23'), V2, 'title', 'Two again', 320),
      property(uid('24'), V2, 'summary', 'Short', 315),
      property(uid('25'), V2, 'summary', 'Not the attester', 316, { attester: OTHER }),
    ]
    for (const asOf of [115, 125, 305, 312, 318, 325, 335, 450, 600]) {
      const atTime = await readSeedAtTime(SEED, asOf)
      const expected = (atTime?.properties ?? []).filter((p) => !p.revoked).map((p) => p.id).sort()
      const entry = (await getSeedAttestations([SEED], { asOf })).get(SEED)
      expect(entry?.properties.map((p) => p.attestationUid).sort() ?? [], `asOf ${asOf}`).toEqual(expected)
      if (atTime?.version) expect(entry?.record.versionUid, `asOf ${asOf}`).toBe(atTime.version.id)
    }
  })

  it("refuses source: 'local'", async () => {
    await expect(getSeedAttestations([SEED], { asOf: 200, source: 'local' })).rejects.toThrow(/source: 'local'/)
  })

  it('narrows to a pinned Version', async () => {
    fakeEas.versions = [attestation(V1, SEED, 110), attestation(V2, SEED, 300)]
    fakeEas.properties = [property(uid('21'), V1, 'title', 'One', 120), property(uid('22'), V1, 'title', 'Later', 350)]
    const entry = (await getSeedAttestations([SEED], { asOf: 400, pins: new Map([[SEED, { versionUid: V1 }]]) })).get(SEED)!
    expect(entry.record.versionUid).toBe(V1)
    expect(entry.record.data.title).toBe('Later')
  })
})

describe('getSeedAttestations versions without asOf', () => {
  it('runs the history to the newest Version', async () => {
    fakeEas.versions = [attestation(V1, SEED, 110), attestation(V2, SEED, 300)]
    const entry = (await getSeedAttestations([SEED], { source: 'remote' })).get(SEED)!
    expect(entry.versions.map((v) => v.attestationUid)).toEqual([V1, V2])
  })
})
