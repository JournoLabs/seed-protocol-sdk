import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { digestHex, getBagFile, validateBag, type Bag } from '@seedprotocol/archive'
import { setPreferredArweaveReadBaseUrls } from '@seedprotocol/arweave'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { BaseDb } from '@/db/Db/BaseDb'
import { Model } from '@/Model/Model'
import { metadata, seeds, versions } from '@/seedSchema'
import { exportArchive } from '@/archive/exportArchive'
import { verifyArchiveAgainstChain } from '@/archive/verifyArchiveAgainstChain'
import { encodeCompositeUpload } from '@/helpers/compositeUpload'
import { waitForPendingOutboxOps } from '@/outbox'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'

/**
 * A reproducible bag from EAS and Arweave alone: the fake chain and gateway below are the whole
 * record. Only the last test gives this device rows for the seed.
 */
type FakeAttestation = {
  id: string
  schemaId: string
  refUID: string
  attester: string
  timeCreated: number
  revoked: boolean
  revocationTime: number
  decodedDataJson: string
}

const fakeEas = vi.hoisted(() => ({
  down: false,
  seeds: [] as FakeAttestation[],
  versions: [] as FakeAttestation[],
  properties: [] as FakeAttestation[],
}))

vi.mock('@seedprotocol/eas', async (importOriginal) => {
  const reachable = <T>(rows: T[]): T[] => {
    if (fakeEas.down) throw new Error('indexer down')
    return rows
  }
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getSeedsByUidsFromEas: async ({ uids }: { uids: string[] }) => reachable(fakeEas.seeds.filter((s) => uids.includes(s.id))),
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
      reachable(fakeEas.versions.filter((v) => seedUids.includes(v.refUID))),
    getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
      reachable(fakeEas.properties.filter((p) => versionUids.includes(p.refUID))),
  }
})

const SCHEMA_NAME = 'Test Schema exportArchive chain'
const ATTESTER = '0xDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDd'
const OTHER = '0xEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEe'
const GATEWAY = 'https://gateway.test'
const T0 = 1791500000
const uid = (byte: string) => `0x${byte.repeat(32)}`
const tx = (name: string) => name.padEnd(43, 'x')

const POST = uid('11')
const VERSION = uid('12')
const AUTHOR = uid('13')
const READERS = [uid('14'), uid('15')]
const IMAGE = uid('16')
const IMAGE_VERSION = uid('17')
const HTML = uid('18')
const HTML_VERSION = uid('19')
const NOTE = uid('1a')
const NOTE_VERSION = uid('1b')
const IMAGE_TX = tx('chainexportimage')
const HTML_TX = tx('chainexporthtml')
const EMBEDDED_TX = tx('chainexportembedded')
const NOTE_TX = tx('chainexportnote')

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
const EMBEDDED_PNG = new Uint8Array([...PNG, 0])
const encode = (s: string) => new TextEncoder().encode(s)
// A BOM and a byte that isn't UTF-8: decoding and encoding again would change both.
const HTML_BYTES = new Uint8Array([
  0xef, 0xbb, 0xbf,
  ...encode(`<article class="h-entry"><h1 class="p-name">Chain post</h1><img src="https://arweave.net/${EMBEDDED_TX}">`),
  0xff,
  ...encode('</article>'),
])

let gateway: Map<string, Uint8Array>
let nextByte = 0x40

const attestation = (id: string, refUID: string, timeCreated: number, extra: Partial<FakeAttestation> = {}): FakeAttestation => ({
  id,
  schemaId: uid('aa'),
  refUID,
  attester: ATTESTER,
  timeCreated,
  revoked: false,
  revocationTime: 0,
  decodedDataJson: '',
  ...extra,
})

/** A property attestation, with decodedDataJson as the EAS indexer writes it. */
const property = (version: string, name: string, type: string, value: unknown, timeCreated: number, extra: Partial<FakeAttestation> = {}) => {
  const signature = `${type} ${name}`
  const schemaId = `0x${[...signature].map((c) => c.charCodeAt(0).toString(16)).join('').padEnd(64, 'c').slice(0, 64)}`
  const id = uid((nextByte++).toString(16).padStart(2, '0'))
  return attestation(id, version, timeCreated, {
    schemaId,
    decodedDataJson: JSON.stringify([{ name, type, signature, value: { name, type, value } }]),
    ...extra,
  })
}

const storageSeed = (seed: string, version: string, txId: string) => {
  fakeEas.seeds.push(attestation(seed, uid('00'), T0))
  fakeEas.versions.push(attestation(version, seed, T0))
  fakeEas.properties.push(property(version, 'storage_transaction_id', 'string', txId, T0))
}

function publishPost() {
  fakeEas.down = false
  fakeEas.seeds = [attestation(POST, uid('00'), T0), attestation(AUTHOR, uid('00'), T0), ...READERS.map((r) => attestation(r, uid('00'), T0))]
  fakeEas.versions = [attestation(VERSION, POST, T0)]
  fakeEas.properties = [
    property(VERSION, 'title', 'string', 'First title', T0),
    property(VERSION, 'word_count', 'string', '1200', T0),
    property(VERSION, 'featured', 'bool', true, T0),
    property(VERSION, 'author', 'bytes32', AUTHOR, T0),
    property(VERSION, 'reader_id_chain_writer_ids', 'bytes32[]', READERS, T0),
    property(VERSION, 'feature_image', 'bytes32', IMAGE, T0),
    property(VERSION, 'body', 'bytes32', HTML, T0),
  ]
  storageSeed(IMAGE, IMAGE_VERSION, IMAGE_TX)
  storageSeed(HTML, HTML_VERSION, HTML_TX)
  gateway = new Map([
    [IMAGE_TX, PNG],
    [HTML_TX, HTML_BYTES],
    [EMBEDDED_TX, EMBEDDED_PNG],
  ])
}

const REF = { seedUid: POST, modelName: 'ChainPost', schemaName: SCHEMA_NAME }
const text = (bag: Bag, path: string) => new TextDecoder().decode(getBagFile(bag, path)?.bytes)
const hash = (bag: Bag) => text(bag, 'tagmanifest-sha256.txt')
const itemJson = (bag: Bag) => JSON.parse(text(bag, 'data/item.json'))
const exported = async (asOf?: number) => (await exportArchive(REF, { reproducible: true, asOf })).bag

// Runs under Node only: nothing here is browser-specific, and the fake gateway replaces fetch.
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('exportArchive from the chain', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = {
      name: SCHEMA_NAME,
      models: {
        ChainPost: {
          properties: {
            title: { type: 'Text' },
            wordCount: { type: 'Number' },
            featured: { type: 'Boolean' },
            author: { type: 'Relation', model: 'ChainWriter' },
            readerIds: { type: 'List', refValueType: 'Relation', ref: 'ChainWriter' },
            featureImage: { type: 'Image' },
            body: { type: 'Html' },
          },
        },
        ChainWriter: { properties: { name: { type: 'Text' } } },
        ChainNote: {
          properties: {
            storageTransactionId: { type: 'Text' },
            draft: { type: 'Text', storageType: 'ItemStorage', localStorageDir: '/notes', filenameSuffix: '.txt' },
            outline: { type: 'Text', storageType: 'ItemStorage', localStorageDir: '/notes', filenameSuffix: '.md' },
          },
        },
      },
    }
    await importJsonSchema({ contents: JSON.stringify(schema) })
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && !Model.findByModelType('chain_note')?.properties?.length) {
      await new Promise((r) => setTimeout(r, 100))
    }
    setPreferredArweaveReadBaseUrls([GATEWAY])
  }, SETUP_HOOK_TIMEOUT_MS)

  beforeEach(() => {
    publishPost()
    vi.stubGlobal('fetch', async (url: string) => {
      const id = String(url).startsWith(`${GATEWAY}/raw/`) ? String(url).split('/').pop()! : ''
      const bytes = gateway.get(id)
      return new Response(bytes ?? null, { status: bytes ? 200 : 404 })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    setPreferredArweaveReadBaseUrls([])
    await teardownTestEnvironment()
  })

  it('builds a valid bag on a device that holds no rows for the seed', async () => {
    const db = BaseDb.getAppDb()
    expect(await db.select().from(seeds).where(eq(seeds.uid, POST))).toEqual([])

    const { bag, omitted } = await exportArchive(REF, { reproducible: true })
    expect(omitted).toEqual([])
    expect(validateBag(bag)).toEqual({ valid: true, errors: [] })

    const { properties, seedUid, versionUid, attester, asOf } = itemJson(bag)
    expect({ seedUid, versionUid, attester }).toEqual({ seedUid: POST, versionUid: VERSION, attester: ATTESTER })
    expect(asOf).toBe(new Date(T0 * 1000).toISOString())
    expect(properties.title).toMatchObject({ value: 'First title', attestedAtClock: 'chain-block' })
    expect(properties.wordCount.value).toBe('1200')
    expect(properties.featured.value).toBe('true')
    expect(properties.author.value).toBe(AUTHOR)
    expect(properties.readerIds.value).toEqual(READERS)
    expect(properties.featureImage).toMatchObject({
      arweaveTransactionId: IMAGE_TX,
      file: `assets/${digestHex('sha256', PNG)}.png`,
    })
    expect(properties.body).toMatchObject({ arweaveTransactionId: HTML_TX, file: 'source/body.html' })
    expect(await db.select().from(metadata).where(eq(metadata.seedUid, POST))).toEqual([])
  }, 120000)

  it('keeps each Html byte for byte in data/source', async () => {
    const bag = await exported()
    expect(digestHex('sha256', getBagFile(bag, 'data/source/body.html')!.bytes)).toBe(digestHex('sha256', HTML_BYTES))
    // The embedded image is in the bag, and only the view copy points at it.
    const embedded = `assets/${digestHex('sha256', EMBEDDED_PNG)}.png`
    expect(getBagFile(bag, `data/${embedded}`)?.bytes).toEqual(EMBEDDED_PNG)
    expect(text(bag, 'data/index.html')).toContain(`src="${embedded}"`)
  }, 120000)

  it('gives the same bag at a time after a patch comes later', async () => {
    const before = await exported()
    const patch = property(VERSION, 'title', 'string', 'Patched title', T0 + 100)
    fakeEas.properties.push(patch)

    const atFirst = await exported(T0)
    expect(hash(atFirst)).toBe(hash(before))
    expect(itemJson(atFirst).properties.title.value).toBe('First title')

    const latest = await exported()
    expect(itemJson(latest).properties.title).toMatchObject({ value: 'Patched title', attestationUid: patch.id })
    expect(itemJson(latest).asOf).toBe(new Date((T0 + 100) * 1000).toISOString())
    expect(text(latest, 'metadata/premis.xml')).toContain(patch.id)
    expect(text(atFirst, 'metadata/premis.xml')).not.toContain(patch.id)
  }, 120000)

  it('gives the same bag at a time after that time has been revoked or retracted', async () => {
    const patch = property(VERSION, 'title', 'string', 'Patched title', T0 + 100)
    fakeEas.properties.push(patch)
    const before = await exported(T0 + 100)
    expect(itemJson(before).properties.title.value).toBe('Patched title')

    // A revoked patch hands the property back to the attestation before it, from then on.
    patch.revoked = true
    patch.revocationTime = T0 + 200
    expect(hash(await exported(T0 + 100))).toBe(hash(before))
    const afterRevoke = await exported()
    expect(itemJson(afterRevoke).properties.title.value).toBe('First title')
    expect(itemJson(afterRevoke).asOf).toBe(new Date((T0 + 200) * 1000).toISOString())

    // Every attestation of a property revoked, on a live seed: a retraction, so no value.
    const first = fakeEas.properties.find((p) => p.decodedDataJson.includes('First title'))!
    first.revoked = true
    first.revocationTime = T0 + 300
    expect(hash(await exported(T0 + 100))).toBe(hash(before))
    expect(itemJson(await exported()).properties.title.value).toBeNull()
  }, 120000)

  it('picks the Version live at the time, and leaves later Versions and revocations out', async () => {
    const newer = uid('21')
    const before = await exported()
    fakeEas.versions.push(attestation(newer, POST, T0 + 500))
    fakeEas.properties.push(property(newer, 'title', 'string', 'Second Version', T0 + 500))

    expect(hash(await exported(T0))).toBe(hash(before))
    expect(itemJson(await exported()).versionUid).toBe(newer)

    fakeEas.versions.find((v) => v.id === VERSION)!.revoked = true
    fakeEas.versions.find((v) => v.id === VERSION)!.revocationTime = T0 + 600
    fakeEas.seeds.find((s) => s.id === POST)!.revoked = true
    fakeEas.seeds.find((s) => s.id === POST)!.revocationTime = T0 + 700
    expect(hash(await exported(T0))).toBe(hash(before))

    await expect(exported()).rejects.toMatchObject({ code: 'not_published' })
    await expect(exported(T0 - 1)).rejects.toMatchObject({ code: 'not_published' })
  }, 120000)

  it('reads a storage seed as it was at the time', async () => {
    const before = await exported(T0)
    const newerImage = new Uint8Array([...PNG, 1])
    gateway.set(tx('chainexportimage2'), newerImage)
    fakeEas.properties.push(property(IMAGE_VERSION, 'storage_transaction_id', 'string', tx('chainexportimage2'), T0 + 100))
    expect(hash(await exported(T0))).toBe(hash(before))
  }, 120000)

  it('ignores attestations from another account', async () => {
    const before = await exported()
    fakeEas.properties.push(property(VERSION, 'title', 'string', 'Forged', T0 + 100, { attester: OTHER }))
    fakeEas.versions.push(attestation(uid('22'), POST, T0 + 100, { attester: OTHER }))
    expect(hash(await exported())).toBe(hash(before))
  }, 120000)

  it('splits an ItemStorage composite by property', async () => {
    fakeEas.seeds.push(attestation(NOTE, uid('00'), T0))
    fakeEas.versions.push(attestation(NOTE_VERSION, NOTE, T0))
    fakeEas.properties.push(property(NOTE_VERSION, 'storage_transaction_id', 'string', NOTE_TX, T0))
    gateway.set(NOTE_TX, encodeCompositeUpload([{ name: 'draft', bytes: encode('the draft') }, { name: 'outline', bytes: encode('the outline') }]))
    const { bag } = await exportArchive({ seedUid: NOTE, modelName: 'ChainNote', schemaName: SCHEMA_NAME }, { reproducible: true })
    const { properties } = itemJson(bag)
    expect(new TextDecoder().decode(getBagFile(bag, `data/${properties.draft.file}`)?.bytes)).toBe('the draft')
    expect(new TextDecoder().decode(getBagFile(bag, `data/${properties.outline.file}`)?.bytes)).toBe('the outline')
  }, 120000)

  it('verifies a bag of an older state, and names what a changed file differs in', async () => {
    const { bag } = await exportArchive(REF, { reproducible: true })
    fakeEas.properties.push(property(VERSION, 'title', 'string', 'Patched title', T0 + 100))
    const good = await verifyArchiveAgainstChain(bag, REF)
    expect(good.rebuilt.status).toBe('passed')
    expect(good.differingFiles).toEqual([])

    gateway.set(HTML_TX, encode('<p>the gateway lies</p>'))
    const bad = await verifyArchiveAgainstChain(bag, REF)
    expect(bad.rebuilt.status).toBe('failed')
    expect(bad.differingFiles).toContain('data/source/body.html')
  }, 120000)

  it('refuses what it cannot build', async () => {
    gateway.delete(IMAGE_TX)
    await expect(exported()).rejects.toMatchObject({ code: 'incomplete' })
    publishPost()

    await expect(exportArchive({ ...REF, seedUid: uid('23') }, { reproducible: true })).rejects.toMatchObject({ code: 'not_synced' })
    await expect(exportArchive({ ...REF, modelName: 'NoSuchModel' }, { reproducible: true })).rejects.toMatchObject({ code: 'invalid_options' })
    await expect(exportArchive(REF, { asOf: T0 })).rejects.toMatchObject({ code: 'invalid_options' })
    await expect(exportArchive(REF, { reproducible: true, asOf: T0 + 0.5 })).rejects.toMatchObject({ code: 'invalid_options' })
    await expect(exportArchive(REF, { reproducible: true, fetch: false })).rejects.toMatchObject({ code: 'invalid_options' })
    await expect(exportArchive(REF, { reproducible: true, sourceOrganization: 'Desk' })).rejects.toMatchObject({ code: 'invalid_options' })

    fakeEas.down = true
    await expect(exported()).rejects.toMatchObject({ code: 'chain_unavailable' })
  }, 120000)

  it('refuses while EAS is behind what this device attested, and ignores its unpublished edits', async () => {
    const post = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'ChainPost', title: 'Local' } as any)
    await waitForIdle(post, 'Item', 15000)
    await waitForPendingOutboxOps()
    const db = BaseDb.getAppDb()
    await db.update(seeds).set({ uid: POST, publisher: ATTESTER }).where(eq(seeds.localId, post.seedLocalId))
    await db.update(versions).set({ uid: VERSION, seedUid: POST, attestationCreatedAt: Date.now() }).where(eq(versions.seedLocalId, post.seedLocalId))

    // A draft edit stays out: the bag is the chain's.
    const bag = (await exportArchive(post, { reproducible: true })).bag
    expect(itemJson(bag).properties.title.value).toBe('First title')

    await db
      .update(metadata)
      .set({ uid: uid('24'), seedUid: POST, versionUid: VERSION, attestationCreatedAt: Date.now() })
      .where(eq(metadata.seedLocalId, post.seedLocalId))
    await expect(exportArchive(post, { reproducible: true })).rejects.toMatchObject({ code: 'not_synced' })
    // An explicit time doesn't depend on this device being covered.
    expect(hash((await exportArchive(post, { reproducible: true, asOf: T0 })).bag)).toBe(hash(bag))

    await db.update(versions).set({ uid: uid('25') }).where(eq(versions.seedLocalId, post.seedLocalId))
    await expect(exportArchive(post, { reproducible: true })).rejects.toMatchObject({ code: 'not_synced' })
  }, 120000)
})
