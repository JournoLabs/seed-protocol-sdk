import { beforeEach, describe, it, expect } from 'vitest'
import { buildPathManifest, createBag, digestHex, verifyArchive, type Bag } from '../src'
import {
  ARCHIVE_ANCHOR_SCHEMA_UID,
  VERSION_SCHEMA_UID,
  decodeArchiveAnchorData,
  findArchiveAnchors,
  verifyPublishedArchive,
} from '../src/verify'

const uid = (byte: string) => `0x${byte.repeat(32)}`
const SEED = uid('11')
const VERSION = uid('12')
const ANCHOR = uid('13')
const TITLE = uid('14')
const SOURCE_TX = 'S'.repeat(43)
const ATTESTER = `0x${'aa'.repeat(20)}`
const OTHER = `0x${'bb'.repeat(20)}`
const EAS = 'https://eas.test/graphql'
const GATEWAY = 'https://gateway.test'
const AS_OF = 1791500000
const asOfIso = new Date(AS_OF * 1000).toISOString()
const encoder = new TextEncoder()

/** A base64url id whose hex form is easy to write: 32 bytes of `byte`. */
const txOf = (bytes: Uint8Array) => {
  const hex = digestHex('sha256', bytes)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const bits = [...hex].map((c) => parseInt(c, 16).toString(2).padStart(4, '0')).join('') + '00'
  return { id: bits.match(/.{6}/g)!.map((b) => alphabet[parseInt(b, 2)]).join(''), hex }
}

const itemJson = (properties: Record<string, unknown> = { title: { attestationUid: TITLE, arweaveTransactionId: SOURCE_TX } }, version = VERSION) =>
  encoder.encode(JSON.stringify({ seedUid: SEED, versionUid: version, properties }))

const makeBag = (version = VERSION, asOf = asOfIso, body = '<p>view</p>', item = itemJson(undefined, version)): Bag =>
  createBag({
    payload: [
      { path: 'index.html', bytes: encoder.encode(body) },
      { path: 'item.json', bytes: item },
    ],
    info: [['Seed-Version-Uid', version], ['Seed-Bag-As-Of', asOf]],
    baggingDate: new Date(AS_OF * 1000),
  })

let gateway: Map<string, Uint8Array>
let gatewayReads: string[]
let attestations: Record<string, any>[]

const att = (id: string, schemaId: string, refUID: string, extra: Record<string, unknown> = {}) => ({
  id, schemaId, refUID, attester: ATTESTER, timeCreated: AS_OF + 10, revoked: false, revocationTime: 0, data: '0x', ...extra,
})

/** Puts `bag` on the fake gateway and an anchor for `hash` on the fake chain. */
function publish(bag: Bag, hash = verifyArchive(bag).tagmanifestSha256!, extra: Record<string, unknown> = {}) {
  const transactions: Record<string, string> = {}
  for (const file of bag.files) {
    const { id } = txOf(file.bytes)
    transactions[file.path] = id
    gateway.set(id, file.bytes)
  }
  const { bytes } = buildPathManifest(bag, transactions)
  const manifest = txOf(bytes)
  gateway.set(manifest.id, bytes)
  const data = `0x${AS_OF.toString(16).padStart(64, '0')}${manifest.hex}${hash}`
  attestations.push(att(ANCHOR, ARCHIVE_ANCHOR_SCHEMA_UID, VERSION, { data, ...extra }))
  return { manifestTx: manifest.id }
}

const fakeFetch = (async (url: string, init?: { body?: string }) => {
  if (url === EAS) {
    const { where } = JSON.parse(init!.body!).variables
    const rows = where.OR
      ? attestations.filter((a) => a.id === VERSION || (a.refUID === VERSION && a.schemaId === ARCHIVE_ANCHOR_SCHEMA_UID))
      : where.id.in
        ? attestations.filter((a) => where.id.in.includes(a.id))
        : attestations.filter((a) => a.id === where.id.equals)
    return Response.json({ data: { attestations: rows } })
  }
  gatewayReads.push(url.split('/').pop()!)
  const bytes = gateway.get(url.split('/').pop()!)
  return new Response(bytes ?? null, { status: bytes ? 200 : 404 })
}) as typeof globalThis.fetch

const run = (extra = {}) =>
  verifyPublishedArchive({ versionUid: VERSION, easEndpoint: EAS, gateways: [GATEWAY], fetch: fakeFetch, ...extra })

describe('verifyPublishedArchive', () => {
  beforeEach(() => {
    gateway = new Map()
    gatewayReads = []
    attestations = [att(SEED, uid('aa'), uid('00')), att(VERSION, VERSION_SCHEMA_UID, SEED), att(TITLE, uid('bb'), VERSION)]
  })

  it('passes every check it can run, and reports the proof it has no way to run', async () => {
    const { manifestTx } = publish(makeBag())
    const result = await run()
    expect(result.attestation.status).toBe('passed')
    expect(result.fixity.status).toBe('passed')
    expect(result.anchor.status).toBe('passed')
    expect(result.identity.status).toBe('passed')
    expect(result.record.status).toBe('passed')
    expect(result.revocation.status).toBe('passed')
    expect(result.timestamp.status).toBe('not_checked')
    expect(result.archiveAnchor).toMatchObject({ uid: ANCHOR, coveredUntil: AS_OF, manifestTx, attester: ATTESTER })
    expect(result.recorded).toEqual({ seedUid: SEED, versionUid: VERSION, attestations: { title: TITLE }, transactions: { title: SOURCE_TX } })
  })

  it('fails the anchor for a bag with consistent manifests that was not the one anchored', async () => {
    publish(makeBag(VERSION, asOfIso, '<p>forged</p>'), 'c'.repeat(64))
    const result = await run()
    expect(result.fixity.status).toBe('passed')
    expect(result.anchor.status).toBe('failed')
  })

  it('fails fixity for a file the gateway changed', async () => {
    const bag = makeBag()
    publish(bag)
    gateway.set(txOf(bag.files.find((f) => f.path === 'data/index.html')!.bytes).id, encoder.encode('tampered'))
    const result = await run()
    expect(result.fixity.status).toBe('failed')
    expect(result.attestation.status).toBe('passed')
  })

  it('ignores an anchor from anyone but the attester', async () => {
    publish(makeBag(), undefined, { attester: OTHER })
    const result = await run()
    expect(result.attestation.status).toBe('no_anchor')
    expect(result.archiveAnchor).toBeUndefined()
    expect(result.fixity.status).toBe('not_checked')
  })

  it('ignores a revoked anchor', async () => {
    publish(makeBag(), undefined, { revoked: true, revocationTime: AS_OF + 20 })
    expect((await run()).attestation.status).toBe('no_anchor')
  })

  it("refuses a Version that isn't from its seed's attester", async () => {
    publish(makeBag())
    attestations.find((a) => a.id === SEED)!.attester = OTHER
    expect((await run()).attestation.status).toBe('failed')
  })

  it('fails identity for a bag of something else, anchored all the same', async () => {
    publish(makeBag(uid('99')))
    expect((await run()).identity.status).toBe('failed')
  })

  it('reports a revoked Version alongside a bag that checks out', async () => {
    publish(makeBag())
    Object.assign(attestations.find((a) => a.id === VERSION)!, { revoked: true, revocationTime: AS_OF + 30 })
    const result = await run()
    expect(result.revocation.status).toBe('failed')
    expect(result.anchor.status).toBe('passed')
  })

  it('picks the anchor for a time, and fails when there is none', async () => {
    publish(makeBag())
    expect((await run({ asOf: AS_OF })).attestation.status).toBe('passed')
    expect((await run({ asOf: AS_OF + 1 })).attestation.status).toBe('no_anchor')
  })

  it('reports a Version with no anchor as no_anchor, not a failure', async () => {
    const result = await run()
    expect(result.attestation.status).toBe('no_anchor')
    expect(result.revocation.status).toBe('passed')
    expect(result.fixity.status).toBe('not_checked')
  })

  it("says not_checked for a Version the indexer hasn't reported", async () => {
    attestations = attestations.filter((a) => a.id !== VERSION)
    const result = await run()
    expect(result.attestation.status).toBe('not_checked')
    expect(result.attestation.detail).toContain("hasn't reported")
  })

  it('fails revocation for a revoked seed', async () => {
    publish(makeBag())
    Object.assign(attestations.find((a) => a.id === SEED)!, { revoked: true, revocationTime: AS_OF + 30 })
    const result = await run()
    expect(result.revocation.status).toBe('failed')
    expect(result.revocation.detail).toContain('seed')
  })

  it('fails the record for an attestation that is on another Version or from someone else', async () => {
    const elsewhere = uid('15')
    const stranger = uid('16')
    attestations.push(att(elsewhere, uid('bb'), uid('99')), att(stranger, uid('bb'), VERSION, { attester: OTHER }))
    publish(makeBag(VERSION, asOfIso, '<p>view</p>', itemJson({ title: { attestationUid: TITLE }, body: { attestationUid: elsewhere }, by: { attestationUid: stranger } })))
    const result = await run()
    expect(result.anchor.status).toBe('passed')
    expect(result.record.status).toBe('failed')
    expect(result.record.detail).toContain(`body (${elsewhere})`)
    expect(result.record.detail).toContain(`by (${stranger})`)
    expect(result.record.detail).not.toContain('title')
  })

  it('fails the record when item.json names another Version', async () => {
    const bag = makeBag(VERSION, asOfIso, '<p>view</p>', itemJson(undefined, uid('99')))
    publish(bag)
    expect((await run()).record.status).toBe('failed')
  })

  it('checks the tag files alone when the payload is over maxBytes', async () => {
    const bag = makeBag()
    publish(bag)
    const payload = bag.files.filter((f) => f.path.startsWith('data/'))
    const payloadBytes = payload.reduce((n, f) => n + f.bytes.byteLength, 0)
    const result = await run({ maxBytes: payloadBytes - 1 })
    expect(result.size).toEqual({ payloadBytes, payloadFiles: payload.length })
    expect(result.anchor.status).toBe('passed')
    expect(result.identity.status).toBe('passed')
    expect(result.fixity.status).toBe('not_checked')
    expect(result.record.status).toBe('not_checked')
    for (const file of payload) expect(gatewayReads).not.toContain(txOf(file.bytes).id)

    expect((await run({ maxBytes: payloadBytes })).fixity.status).toBe('passed')
  })

  it('reports progress through the payload against Payload-Oxum', async () => {
    const bag = makeBag()
    publish(bag)
    const progress: { loadedBytes: number; totalBytes: number }[] = []
    await run({ onProgress: (p: { loadedBytes: number; totalBytes: number }) => progress.push(p) })
    const payloadBytes = bag.files.filter((f) => f.path.startsWith('data/')).reduce((n, f) => n + f.bytes.byteLength, 0)
    expect(progress.length).toBe(2)
    expect(progress.at(-1)).toEqual({ loadedBytes: payloadBytes, totalBytes: payloadBytes })
  })

  it('stops when the signal aborts', async () => {
    publish(makeBag())
    const controller = new AbortController()
    const reason = new Error('reader left')
    const abortingFetch = (async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
      if (url !== EAS) controller.abort(reason)
      if (init?.signal?.aborted) throw init.signal.reason
      return fakeFetch(url, init)
    }) as typeof globalThis.fetch
    await expect(run({ fetch: abortingFetch, signal: controller.signal })).rejects.toBe(reason)
  })

  it('says not_checked, and does not throw, when a service is down', async () => {
    publish(makeBag())
    const down = (async () => new Response(null, { status: 503 })) as typeof globalThis.fetch
    const easDown = await run({ fetch: down })
    expect(easDown.attestation.status).toBe('not_checked')

    gateway.clear()
    const gatewayDown = await run()
    expect(gatewayDown.attestation.status).toBe('passed')
    expect(gatewayDown.fixity.status).toBe('not_checked')
    expect(gatewayDown.fixity.detail).toContain("Couldn't read manifest")
  })

  it('falls through to the next gateway', async () => {
    publish(makeBag())
    const fetchOne = (async (url: string, init?: object) =>
      url.startsWith('https://down.test') ? Promise.reject(new Error('offline')) : fakeFetch(url, init)) as typeof globalThis.fetch
    const result = await run({ fetch: fetchOne, gateways: ['https://down.test', GATEWAY] })
    expect(result.anchor.status).toBe('passed')
  })
})

describe('findArchiveAnchors', () => {
  beforeEach(() => {
    gateway = new Map()
    gatewayReads = []
    attestations = [att(SEED, uid('aa'), uid('00')), att(VERSION, VERSION_SCHEMA_UID, SEED)]
  })

  it("lists the attester's live anchors without reading a gateway", async () => {
    const { manifestTx } = publish(makeBag())
    attestations.push(att(uid('20'), ARCHIVE_ANCHOR_SCHEMA_UID, VERSION, { attester: OTHER, data: attestations.at(-1)!.data }))
    const anchors = await findArchiveAnchors({ versionUid: VERSION, easEndpoint: EAS, fetch: fakeFetch })
    expect(anchors).toEqual([{ uid: ANCHOR, attester: ATTESTER, coveredUntil: AS_OF, manifestTx, tagmanifestSha256: expect.any(String), timeCreated: AS_OF + 10 }])
    expect(gatewayReads).toEqual([])
  })

  it("returns none for a Version the indexer hasn't reported", async () => {
    attestations = []
    expect(await findArchiveAnchors({ versionUid: VERSION, easEndpoint: EAS, fetch: fakeFetch })).toEqual([])
  })
})

describe('decodeArchiveAnchorData', () => {
  it("returns undefined for data that isn't an anchor", () => {
    expect(decodeArchiveAnchorData('0x')).toBeUndefined()
    expect(decodeArchiveAnchorData(`0x${'f'.repeat(192)}`)).toBeUndefined()
  })
})
