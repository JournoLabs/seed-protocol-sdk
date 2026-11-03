import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attestation } from '@seedprotocol/eas'
import type { AttestationLike } from '@seedprotocol/query'

const fakeEas = vi.hoisted(() => ({
  seeds: [] as AttestationLike[],
  versions: [] as AttestationLike[],
  properties: [] as AttestationLike[],
}))

vi.mock('../../query/src/bootstrap.js', () => ({
  initializeQueryPlatform: vi.fn().mockResolvedValue(undefined),
}))

// EAS as it is now: revoked attestations come back marked, with their revocation time.
const asEas = (a: AttestationLike) => ({ revoked: false, revocationTime: 0, ...a }) as Attestation
vi.mock('@seedprotocol/eas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seedprotocol/eas')>()),
  getSeedsByUidsFromEas: async ({ uids }: { uids: string[] }) =>
    fakeEas.seeds.filter((s) => uids.includes(s.id)).map(asEas),
  getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
    fakeEas.versions.filter((v) => seedUids.includes(v.refUID)).map(asEas),
  getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
    fakeEas.properties.filter((p) => versionUids.includes(p.refUID)).map(asEas),
}))

import { exportSeeds, toJsonLd, toNQuads, toTurtle, type ExportSeedsOptions, type RdfLens } from '../src/index'
import { CHAIN_ID, HTML, POST, POST_V1, POST_V2, PUBLISHED_AT, TITLE, chain } from './fixtures'

const B = 'https://w3id.org/seedprotocol/'
const at = (uid: string) => `${B}eas/${CHAIN_ID}/${uid}`

beforeEach(() => {
  const data = chain()
  // The fixture's seeds are dated after their Versions; a seed made later than asOf isn't there yet.
  for (const seed of data.seeds) seed.timeCreated = 90
  Object.assign(fakeEas, data)
})

const lens: RdfLens = {
  schema: {
    id: 'schema-1',
    models: { post: { id: 'model-post', properties: { title: { id: 'prop-title', type: 'Text' } } } },
  },
  sidecar: {
    schemaId: 'schema-1',
    schemaVersion: 1,
    '@context': { dcterms: 'http://purl.org/dc/terms/' },
    terms: { 'prop-title': 'dcterms:title' },
  },
} as unknown as RdfLens

const writers = (graph: Awaited<ReturnType<typeof exportSeeds>>) => ({
  jsonld: JSON.stringify(toJsonLd(graph)),
  turtle: toTurtle(graph),
  nquads: toNQuads(graph),
})

describe('exportSeeds with asOf', () => {
  it('gives the graph EAS held then: the Version and values at that time', async () => {
    const before = toNQuads(await exportSeeds([POST], { chainId: CHAIN_ID, asOf: 150 }))
    expect(before).toContain(`<${at(POST)}> <${B}ns#currentVersion> <${at(POST_V1)}>`)
    expect(before).toContain('"From the old version"')
    expect(before).not.toContain(at(POST_V2))

    const patched = toNQuads(await exportSeeds([POST], { chainId: CHAIN_ID, asOf: 205 }))
    expect(patched).toContain('"Replaced in a patch"')
    expect(patched).toContain(`<${at(POST_V2)}> <http://www.w3.org/ns/prov#wasRevisionOf> <${at(POST_V1)}>`)
  })

  it('counts a value revoked after asOf', async () => {
    const title = fakeEas.properties.find((p) => p.refUID === POST_V2 && p.timeCreated === 210)!
    Object.assign(title, { revoked: true, revocationTime: 300 })
    expect(toNQuads(await exportSeeds([POST], { chainId: CHAIN_ID, asOf: 250 }))).toContain(JSON.stringify(TITLE).slice(0, 10))
    expect(toNQuads(await exportSeeds([POST], { chainId: CHAIN_ID, asOf: 350 }))).toContain('"Replaced in a patch"')
  })

  it("refuses source: 'local'", async () => {
    await expect(exportSeeds([POST], { chainId: CHAIN_ID, asOf: 250, source: 'local' })).rejects.toThrow(/local/)
  })

  it('maps a property to a dcterms term through the sidecar', async () => {
    const turtle = toTurtle(await exportSeeds([POST], { chainId: CHAIN_ID, asOf: PUBLISHED_AT, lens }))
    expect(turtle).toContain('@prefix dcterms: <http://purl.org/dc/terms/> .')
    expect(turtle).toMatch(/dcterms:title "Council/)
  })
})

describe('stable bytes', () => {
  const options: ExportSeedsOptions = { chainId: CHAIN_ID, asOf: PUBLISHED_AT, lens }

  it('two exports with the same seeds, asOf, chain and sidecar are byte-identical', async () => {
    const first = writers(await exportSeeds([POST, HTML], options))
    const second = writers(await exportSeeds([POST, HTML], options))
    expect(second).toEqual(first)
  })

  it("doesn't depend on the order EAS returns attestations in", async () => {
    const first = writers(await exportSeeds([POST, HTML], options))
    fakeEas.seeds.reverse()
    fakeEas.versions.reverse()
    fakeEas.properties.reverse()
    const second = writers(await exportSeeds([POST, HTML], options))
    expect(second.nquads.split('\n')).toEqual(first.nquads.split('\n'))
    expect(second).toEqual(first)
  })

  it('keeps list order, which is part of the value', async () => {
    const authors = fakeEas.properties.find((p) => p.decodedDataJson.includes('author_identity_ids'))!
    const first = toNQuads(await exportSeeds([POST], options))
    authors.decodedDataJson = authors.decodedDataJson.replace(/\[("0x[^"]+"),("0x[^"]+")\]/g, '[$2,$1]')
    expect(toNQuads(await exportSeeds([POST], options))).not.toBe(first)
  })
})
