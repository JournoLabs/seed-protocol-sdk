import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { createBag, parsePathManifest, verifyArchive, type Bag } from '@seedprotocol/archive'
import * as verifyEntry from '@seedprotocol/archive/verify'
import { ARCHIVE_ANCHOR_SCHEMA_DEF, ARCHIVE_ANCHOR_SCHEMA_UID, VERSION_SCHEMA_UID, arweaveTxIdToBytes32 } from '@seedprotocol/eas'

const ATTESTER = '0x00000000000000000000000000000000000000aa'
const uid = (byte: string) => `0x${byte.repeat(32)}`
const SEED = uid('11')
const VERSION = uid('12')
const AS_OF = 1791500000
const SOURCE_TX = 'A'.repeat(43)
const ANCHOR_UID = uid('13')

const encoder = new TextEncoder()
const bagFor = (asOf: number): Bag =>
  createBag({
    payload: [
      { path: 'index.html', bytes: encoder.encode('<p>view</p>') },
      { path: 'source/body.html', bytes: encoder.encode('<p>published</p>') },
    ],
    info: [
      ['Seed-Uid', SEED],
      ['Seed-Version-Uid', VERSION],
      ['EAS-Attester', ATTESTER],
      ['Seed-Bag-As-Of', new Date(asOf * 1000).toISOString()],
    ],
    baggingDate: new Date(asOf * 1000),
  })

const state = {
  exportError: undefined as Error | undefined,
  asOf: AS_OF,
  anchors: [] as { uid: string; coveredUntil: number; manifestTx: string; tagmanifestSha256: string }[],
  schema: true as boolean,
  strategy: 'multiPublish' as 'multiPublish' | 'directEas',
  attester: ATTESTER,
  /** Transaction ids a read doesn't find; `*` for every new one. */
  unreadable: new Set<string>(),
  sendError: undefined as Error | undefined,
  /** Fails the nth signDataItems call. */
  failSign: undefined as number | undefined,
}
const sent: any[][] = []
const sentDirect: any[] = []
let uploads: { name: string; tags: { name: string; value: string }[]; bytes: Uint8Array }[] = []

const realSdk = await import('@seedprotocol/sdk')
mock.module('@seedprotocol/sdk', () => ({
  ...realSdk,
  exportArchive: async () => {
    if (state.exportError) throw state.exportError
    return { bag: bagFor(state.asOf), omitted: [], arweaveTransactions: { 'data/source/body.html': SOURCE_TX } }
  },
}))
const realEas = await import('@seedprotocol/eas')
mock.module('@seedprotocol/eas', () => ({ ...realEas, getArchiveAnchorsFromEas: async () => state.anchors }))
const realConfig = await import('../../config')
mock.module('../../config', () => ({
  ...realConfig,
  getPublishConfig: () => ({
    arweaveUploadTags: [{ name: 'App-Name', value: 'Test' }],
    useDirectEas: state.strategy === 'directEas',
    useModularExecutor: state.strategy === 'multiPublish',
  }),
}))
mock.module('../../helpers/schemaRegistry', () => ({
  getSchemaRecord: async () => (state.schema ? { uid: ARCHIVE_ANCHOR_SCHEMA_UID } : null),
  registerSchema: (args: unknown) => ({ register: args }),
}))
const realChain = await import('../../helpers/chainClient')
mock.module('../../helpers/chainClient', () => ({
  ...realChain,
  waitForPublishReceipt: async () => ({ logs: [] }),
}))
const realDirect = await import('../../helpers/easDirect')
mock.module('../../helpers/easDirect', () => ({
  ...realDirect,
  getAttestedUidsFromReceipt: () => [{ schemaUid: ARCHIVE_ANCHOR_SCHEMA_UID, uid: ANCHOR_UID }],
}))
mock.module('../publish/helpers/verifyArweaveTransactionsExist', () => ({
  verifyArweaveTransactionsExist: async (ids: string[]) => {
    for (const id of ids) if (state.unreadable.has(id)) throw new Error(`${id} not found`)
  },
}))
const realAttest = await import('../publish/actors/createAttestations')
mock.module('../publish/actors/createAttestations', () => ({
  ...realAttest,
  resolveMultiPublishSender: async () => ({
    attesterAddress: state.attester,
    sendMultiPublish: async (requests: any[]) => {
      if (state.sendError) throw state.sendError
      sent.push(requests)
      return { transactionHash: '0x01' }
    },
  }),
}))

const { anchorArchive, ensureArchiveAnchorSchema, estimateArchiveAnchorCost } = await import('./index')
const { encodeMultiPublish } = await import('../../helpers/contracts')
const { ArchiveAnchorInterruptedError, ArchiveAnchorSchemaNotRegisteredError } = await import('../../errors')

const txFor = (n: number) => `${String(n).padStart(2, '0')}${'B'.repeat(40)}A`
let signCalls = 0
const signDataItems = async (list: any[]) => {
  if (++signCalls === state.failSign) throw new Error('upload failed')
  const signed = []
  for (const u of list) {
    const id = txFor(uploads.length)
    uploads.push({ name: u.itemPropertyName, tags: u.tags, bytes: new Uint8Array(await u.blob.arrayBuffer()) })
    signed.push({ transaction: { id }, versionId: '', modelName: u.itemPropertyName })
  }
  return signed
}

const eoa = {
  kind: 'eoa',
  signer: { address: ATTESTER, [Symbol.for('seedprotocol.SeedSigner')]: true },
  txSender: {
    [Symbol.for('seedprotocol.SeedTxSender')]: true,
    address: ATTESTER,
    sendTransaction: async (tx: unknown) => {
      sentDirect.push(tx)
      return { transactionHash: '0x02' }
    },
  },
} as never

const REF = { seedUid: SEED, modelName: 'Post' }
const options = { signDataItems } as never
const tagValue = (u: (typeof uploads)[number], name: string) => u.tags.find((t) => t.name === name)?.value
const decode = (data: string) =>
  Object.fromEntries(new SchemaEncoder(ARCHIVE_ANCHOR_SCHEMA_DEF).decodeData(data).map((f) => [f.name, f.value.value]))

beforeEach(() => {
  Object.assign(state, { exportError: undefined, asOf: AS_OF, anchors: [], schema: true, strategy: 'multiPublish', attester: ATTESTER, unreadable: new Set(), sendError: undefined, failSign: undefined })
  signCalls = 0
  sent.length = 0
  sentDirect.length = 0
  uploads = []
})

describe('anchorArchive', () => {
  test('uploads what no transaction holds, then the manifest, then attests on the Version', async () => {
    const result = await anchorArchive(REF, options)
    const hash = verifyArchive(bagFor(AS_OF)).tagmanifestSha256!
    expect(result).toMatchObject({ uid: ANCHOR_UID, coveredUntil: AS_OF, tagmanifestSha256: hash, alreadyAnchored: false })

    const names = uploads.map((u) => u.name)
    expect(names).not.toContain('data/source/body.html')
    expect(names).toContain('data/index.html')
    expect(names).toContain('bagit.txt')
    expect(names.at(-1)).toBe('manifest')

    const manifest = parsePathManifest(uploads.at(-1)!.bytes)
    expect(result.manifestTx).toBe(txFor(uploads.length - 1))
    expect(manifest.paths['data/source/body.html']?.id).toBe(SOURCE_TX)
    expect(manifest.paths['data/index.html']?.id).toBe(txFor(names.indexOf('data/index.html')))

    const [request] = sent[0]!
    expect(request).toMatchObject({ seedUid: SEED, versionUid: VERSION, versionSchemaUid: VERSION_SCHEMA_UID, propertiesToUpdate: [] })
    const [attestation] = request.listOfAttestations
    expect(attestation.schema).toBe(ARCHIVE_ANCHOR_SCHEMA_UID)
    expect(attestation.data[0].refUID).toBe(VERSION)
    const fields = decode(attestation.data[0].data)
    expect(BigInt(fields.covered_until as bigint)).toBe(BigInt(AS_OF))
    expect(fields.manifest_tx).toBe(arweaveTxIdToBytes32(result.manifestTx))
    expect(fields.tagmanifest_sha256).toBe(`0x${hash}`)
    // What a reader's page decodes, with no EAS code.
    expect(verifyEntry.decodeArchiveAnchorData(attestation.data[0].data)).toEqual({
      coveredUntil: AS_OF,
      manifestTx: result.manifestTx,
      tagmanifestSha256: hash,
    })
    expect(verifyEntry.ARCHIVE_ANCHOR_SCHEMA_UID).toBe(ARCHIVE_ANCHOR_SCHEMA_UID)
    expect(verifyEntry.VERSION_SCHEMA_UID).toBe(VERSION_SCHEMA_UID)
    // The contract encoder takes it as it stands.
    expect(encodeMultiPublish(ATTESTER as `0x${string}`, sent[0]!).data).toMatch(/^0x/)
  })

  test('returns the anchor already there for the same bag, with no upload or send', async () => {
    const tagmanifestSha256 = verifyArchive(bagFor(AS_OF)).tagmanifestSha256!
    state.anchors = [{ uid: ANCHOR_UID, coveredUntil: AS_OF, manifestTx: SOURCE_TX, tagmanifestSha256 }]
    expect(await anchorArchive(REF, options)).toMatchObject({ uid: ANCHOR_UID, manifestTx: SOURCE_TX, alreadyAnchored: true })
    expect(uploads).toEqual([])
    expect(sent).toEqual([])
  })

  test('anchors again for a later time', async () => {
    const tagmanifestSha256 = verifyArchive(bagFor(AS_OF)).tagmanifestSha256!
    state.anchors = [{ uid: ANCHOR_UID, coveredUntil: AS_OF, manifestTx: SOURCE_TX, tagmanifestSha256 }]
    state.asOf = AS_OF + 100
    expect((await anchorArchive(REF, options)).alreadyAnchored).toBe(false)
    expect(sent).toHaveLength(1)
  })

  test('tags parts by policy', async () => {
    await anchorArchive(REF, options)
    const index = uploads.find((u) => u.name === 'data/index.html')!
    expect(tagValue(index, 'Archive-Part')).toBe('index')
    expect(tagValue(index, 'Seed-Version-Uid')).toBe(VERSION)
    expect(tagValue(index, 'App-Name')).toBe('Test')
    expect(tagValue(uploads.find((u) => u.name === 'bagit.txt')!, 'Archive-Part')).toBe('tagfile')
    const manifest = uploads.at(-1)!
    expect(tagValue(manifest, 'Archive-Part')).toBe('manifest')
    expect(tagValue(manifest, 'Content-Type')).toBe('application/x.arweave-manifest+json')

    uploads = []
    await anchorArchive(REF, { ...(options as object), tagPolicy: 'hash-only' } as never)
    for (const upload of uploads) expect(upload.tags.map((t) => t.name)).toEqual(['Content-SHA-256', 'Content-Type'])
  })

  test('uploads nothing when the bag cannot be built or the schema is missing', async () => {
    state.exportError = Object.assign(new Error('behind'), { code: 'not_synced' })
    await expect(anchorArchive(REF, options)).rejects.toMatchObject({ code: 'not_synced' })
    state.exportError = undefined
    state.schema = false
    await expect(anchorArchive(REF, options)).rejects.toBeInstanceOf(ArchiveAnchorSchemaNotRegisteredError)
    expect(uploads).toEqual([])
  })

  test('refuses a wallet that attests as someone else', async () => {
    state.attester = `0x${'b'.repeat(40)}`
    await expect(anchorArchive(REF, options)).rejects.toThrow("the Version's attester")
    expect(sent).toEqual([])
  })

  test('attests directly to EAS for an EOA', async () => {
    state.strategy = 'directEas'
    const { uid: anchor } = await anchorArchive(REF, { ...(options as object), wallet: eoa } as never)
    expect(anchor).toBe(ANCHOR_UID)
    expect(sentDirect).toHaveLength(1)
    expect(sent).toEqual([])
  })
})

describe('anchorArchive after a failure', () => {
  const interrupted = async (extra: object = {}) => {
    const error = await anchorArchive(REF, { ...(options as object), ...extra } as never).catch((e) => e)
    expect(error).toBeInstanceOf(ArchiveAnchorInterruptedError)
    return error as InstanceType<typeof ArchiveAnchorInterruptedError>
  }

  test('a failed attestation retries with no upload', async () => {
    state.sendError = new Error('reverted')
    const error = await interrupted()
    expect(error.message).toContain('reverted')
    expect((error.cause as Error).message).toBe('reverted')
    expect(error.resume.manifestTx).toBeDefined()

    const before = uploads.length
    state.sendError = undefined
    const result = await anchorArchive(REF, { ...(options as object), resumeFrom: error.resume } as never)
    expect(uploads).toHaveLength(before)
    expect(result.manifestTx).toBe(error.resume.manifestTx!)
    expect(sent).toHaveLength(1)
  })

  test('a failed manifest upload keeps the files', async () => {
    state.failSign = 2
    const error = await interrupted()
    expect(error.resume.manifestTx).toBeUndefined()
    const files = uploads.length
    expect(Object.keys(error.resume.transactions)).toHaveLength(files)

    await anchorArchive(REF, { ...(options as object), resumeFrom: error.resume } as never)
    expect(uploads).toHaveLength(files + 1)
    expect(uploads.at(-1)!.name).toBe('manifest')
    const manifest = parsePathManifest(uploads.at(-1)!.bytes)
    expect(manifest.paths['bagit.txt']?.id).toBe(error.resume.transactions['bagit.txt'])
  })

  test('uploads that a read cannot find yet are kept, and reused once they can be', async () => {
    state.unreadable = new Set([txFor(0)])
    const error = await interrupted()
    expect(error.resume.transactions[uploads[0]!.name]).toBe(txFor(0))
    const before = uploads.length
    state.unreadable = new Set()
    await anchorArchive(REF, { ...(options as object), resumeFrom: error.resume } as never)
    expect(uploads.slice(before).map((u) => u.name)).toEqual(['manifest'])
  })

  test('uploads again what never landed, and a new manifest for it', async () => {
    state.sendError = new Error('reverted')
    const { resume } = await interrupted()
    state.sendError = undefined
    const before = uploads.length
    state.unreadable = new Set([resume.transactions['bagit.txt']!])
    const result = await anchorArchive(REF, { ...(options as object), resumeFrom: resume } as never)
    expect(uploads.slice(before).map((u) => u.name)).toEqual(['bagit.txt', 'manifest'])
    expect(result.manifestTx).not.toBe(resume.manifestTx)
  })

  test('ignores uploads from another bag', async () => {
    state.sendError = new Error('reverted')
    const { resume } = await interrupted()
    state.sendError = undefined
    state.asOf = AS_OF + 100
    const before = uploads.length
    await anchorArchive(REF, { ...(options as object), resumeFrom: resume } as never)
    expect(uploads.length - before).toBe(before)
  })

  test('throws the first upload failure as it is, with nothing to resume', async () => {
    state.failSign = 1
    await expect(anchorArchive(REF, options)).rejects.toThrow('upload failed')
    await expect(anchorArchive(REF, options)).resolves.toBeDefined()
  })
})

describe('estimateArchiveAnchorCost', () => {
  test('counts the bag files to upload, the manifest and one attestation', async () => {
    const rates = { gasPriceWei: 1n, ethUsd: 1, arUsd: 1, winstonPerByte: 1, fetchedAt: 0 }
    const { work } = await estimateArchiveAnchorCost(REF, { rates } as never)
    const toUpload = bagFor(AS_OF).files.filter((f) => f.path !== 'data/source/body.html')
    expect(work.uploadCount).toBe(toUpload.length + 1)
    expect(work.attestationCount).toBe(1)
    expect(work.newSeedCount).toBe(0)
    expect(work.uploadSizes!.slice(0, -1)).toEqual(toUpload.map((f) => f.bytes.byteLength))
  })
})

describe('ensureArchiveAnchorSchema', () => {
  test('registers and names the schema once', async () => {
    state.schema = false
    expect(await ensureArchiveAnchorSchema(eoa)).toBe(ARCHIVE_ANCHOR_SCHEMA_UID as `0x${string}`)
    expect(sentDirect).toHaveLength(2)
    state.schema = true
    await ensureArchiveAnchorSchema(eoa)
    expect(sentDirect).toHaveLength(2)
  })
})
