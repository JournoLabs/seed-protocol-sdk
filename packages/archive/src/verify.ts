import { readBagFromManifest, parsePathManifest } from './pathManifest'
import { readBagInfo, verifyArchive, type ArchiveCheck, type ArchiveVerification } from './verifyArchive'

/**
 * Checks a published bag from a browser, importable on its own (`@seedprotocol/archive/verify`) so a
 * page can load it when a reader asks. It reads EAS and an Arweave gateway with `fetch`, and pulls in
 * no Html parser or Seed code. Each check is reported on its own, with no overall verdict.
 */

/** ADR 0029. `@seedprotocol/eas` holds the same values, which a test keeps in step. */
export const ARCHIVE_ANCHOR_SCHEMA_UID = '0xf7f6e2f226f29542fa8bd1763d042d04f47a0a9c3647753f68cc113e26f1739e'
export const VERSION_SCHEMA_UID = '0x13c0fd59d69dbce40501a41f8b37768d26dd2e2bb0cad64615334d84f7b9bdf6'

const DEFAULT_GATEWAYS = ['https://arweave.net']
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const ATTESTATIONS_QUERY = `query ArchiveAttestations($where: AttestationWhereInput!) {
  attestations(where: $where, orderBy: [{ timeCreated: desc }]) {
    id schemaId refUID attester timeCreated revoked revocationTime data
  }
}`

type RawAttestation = {
  id: string
  schemaId: string
  refUID: string
  attester: string
  timeCreated: number
  revoked: boolean
  revocationTime: number
  data: string
}

export type DecodedArchiveAnchor = { coveredUntil: number; manifestTx: string; tagmanifestSha256: string }

export type FindArchiveAnchorsOptions = {
  versionUid: string
  /** The EAS GraphQL endpoint of the Version's chain. */
  easEndpoint: string
  /** Default the global `fetch`. */
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
}

export type VerifyPublishedArchiveOptions = FindArchiveAnchorsOptions & {
  /** Read gateways, tried in order. Default arweave.net. */
  gateways?: readonly string[]
  /** Check the anchor of this time, unix seconds. Default the newest. */
  asOf?: number
  /**
   * Fetch the payload only when `Payload-Oxum` says it is at most this many bytes. Over it, the tag
   * files are still checked, and `fixity` and `record` are `not_checked`.
   */
  maxBytes?: number
  /** Called after each payload file, with the bytes read so far and the `Payload-Oxum` total. */
  onProgress?: (progress: { loadedBytes: number; totalBytes: number }) => void
}

/** A live anchor from the Version's attester, newest first. */
export type ArchiveAnchor = DecodedArchiveAnchor & { uid: string; attester: string; timeCreated: number }

/** `no_anchor`: the Version is on EAS, and its attester hasn't anchored it (or not at `asOf`). */
export type AttestationCheck = Omit<ArchiveCheck, 'status'> & { status: ArchiveCheck['status'] | 'no_anchor' }

/** What the bag's data/item.json says it was built from. */
export type ArchiveRecord = {
  seedUid?: string
  versionUid?: string
  /** Each property's attestation, by property name. */
  attestations: Record<string, string>
  /** Each property's Arweave transaction, by property name. */
  transactions: Record<string, string>
}

export type PublishedArchiveVerification = Omit<ArchiveVerification, 'tagmanifestSha256'> & {
  /** An anchor exists on the Version, from the attester of the Version and its seed. */
  attestation: AttestationCheck
  /** The bag says it is this Version at the anchor's time. */
  identity: ArchiveCheck
  /**
   * Every attestation data/item.json names is on this Version from its attester. Doesn't compare
   * values: that needs the schema.
   */
  record: ArchiveCheck
  /** Neither the Version nor its seed is revoked. A bag says nothing about revocations, so this asks EAS. */
  revocation: ArchiveCheck
  /** A Bitcoin timestamp proof. Anchors have none yet. */
  timestamp: ArchiveCheck
  /** The anchor checked, when there is one. */
  archiveAnchor?: ArchiveAnchor
  /** From bag-info.txt's `Payload-Oxum`, when the tag files were read. */
  size?: { payloadBytes: number; payloadFiles: number }
  /** From data/item.json, when it was read. What a passed check binds to. */
  recorded?: ArchiveRecord
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const notChecked = (detail: string): ArchiveCheck => ({ status: 'not_checked', detail })

const hexWordToTxId = (word: string): string => {
  let bits = ''
  for (const char of word) bits += parseInt(char, 16).toString(2).padStart(4, '0')
  bits += '00'
  let id = ''
  for (let i = 0; i < bits.length; i += 6) id += BASE64URL[parseInt(bits.slice(i, i + 6), 2)]
  return id
}

/** An anchor attestation's `data`: three ABI words. Undefined when it isn't one. */
export function decodeArchiveAnchorData(data: string): DecodedArchiveAnchor | undefined {
  const match = /^0x([0-9a-f]{64})([0-9a-f]{64})([0-9a-f]{64})$/i.exec(data)
  if (!match) return undefined
  const coveredUntil = Number(BigInt(`0x${match[1]}`))
  if (!Number.isSafeInteger(coveredUntil)) return undefined
  return { coveredUntil, manifestTx: hexWordToTxId(match[2]!.toLowerCase()), tagmanifestSha256: match[3]!.toLowerCase() }
}


type AnchorRecord = { version?: RawAttestation; seed?: RawAttestation; anchors: ArchiveAnchor[] }

const queryAttestations = async (
  { easEndpoint, fetch: request, signal }: { easEndpoint: string; fetch: typeof globalThis.fetch; signal?: AbortSignal },
  where: unknown,
): Promise<RawAttestation[]> => {
  const response = await request(easEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ATTESTATIONS_QUERY, variables: { where } }),
    signal,
  })
  if (!response.ok) throw new Error(`EAS answered ${response.status}`)
  const { data } = (await response.json()) as { data?: { attestations?: RawAttestation[] } }
  if (!data?.attestations) throw new Error('EAS answered with no attestations')
  return data.attestations
}

/** The Version, its seed and the live anchors from the Version's attester. Throws when EAS can't be read. */
async function readAnchorRecord(options: FindArchiveAnchorsOptions): Promise<AnchorRecord> {
  const { versionUid, easEndpoint, signal } = options
  const eas = { easEndpoint, signal, fetch: options.fetch ?? globalThis.fetch.bind(globalThis) }
  const rows = await queryAttestations(eas, {
    OR: [{ id: { equals: versionUid } }, { refUID: { equals: versionUid }, schemaId: { equals: ARCHIVE_ANCHOR_SCHEMA_UID } }],
  })
  const version = rows.find((a) => a.id.toLowerCase() === versionUid.toLowerCase() && a.schemaId === VERSION_SCHEMA_UID)
  if (!version) return { anchors: [] }
  const [seed] = await queryAttestations(eas, { id: { equals: version.refUID } })
  const anchors = rows
    .filter((a) => a.schemaId === ARCHIVE_ANCHOR_SCHEMA_UID && !a.revoked && sameAddress(a.attester, version.attester))
    .flatMap((a) => {
      const decoded = decodeArchiveAnchorData(a.data)
      return decoded ? [{ ...decoded, uid: a.id, attester: a.attester, timeCreated: a.timeCreated }] : []
    })
  return { version, seed, anchors }
}

/**
 * The live anchors on a Version from its attester, newest first, without downloading a bag. Empty
 * when the indexer hasn't reported the Version. Throws when EAS can't be read.
 */
export async function findArchiveAnchors(options: FindArchiveAnchorsOptions): Promise<ArchiveAnchor[]> {
  return (await readAnchorRecord(options)).anchors
}

const isTagFile = (path: string): boolean => !path.startsWith('data/')

/** data/item.json's seed, Version and per-property attestation and transaction. */
function readRecord(bytes: Uint8Array): ArchiveRecord {
  const json = JSON.parse(new TextDecoder().decode(bytes)) as {
    seedUid?: string
    versionUid?: string
    properties?: Record<string, { attestationUid?: string; arweaveTransactionId?: string }>
  }
  const record: ArchiveRecord = { seedUid: json.seedUid, versionUid: json.versionUid, attestations: {}, transactions: {} }
  for (const [name, property] of Object.entries(json.properties ?? {})) {
    if (property?.attestationUid) record.attestations[name] = property.attestationUid
    if (property?.arweaveTransactionId) record.transactions[name] = property.arweaveTransactionId
  }
  return record
}

/**
 * Finds the Version's anchor, fetches the bag its manifest lays out, and checks the bag against the
 * anchored hash. Doesn't throw for what it finds: a check that couldn't run is `not_checked`, and
 * `detail` says why. An EAS or gateway failure is a `not_checked`, not a `failed`. Throws only when
 * `signal` aborts.
 */
export async function verifyPublishedArchive(options: VerifyPublishedArchiveOptions): Promise<PublishedArchiveVerification> {
  const { versionUid, easEndpoint, asOf, signal } = options
  const request = options.fetch ?? globalThis.fetch.bind(globalThis)

  const blocked = (attestation: AttestationCheck, revocation?: ArchiveCheck): PublishedArchiveVerification => ({
    attestation,
    fixity: { ...notChecked('There is no bag to check'), errors: [] },
    anchor: notChecked('There is no anchored hash to compare with'),
    identity: notChecked('There is no bag to check'),
    record: notChecked('There is no bag to check'),
    revocation: revocation ?? notChecked('The Version could not be read'),
    timestamp: notChecked('Anchors carry no timestamp proof yet'),
  })
  const rethrowAbort = (error: unknown) => {
    if (signal?.aborted) throw signal.reason ?? error
  }

  let found: AnchorRecord
  try {
    found = await readAnchorRecord({ ...options, fetch: request })
  } catch (error) {
    rethrowAbort(error)
    return blocked(notChecked(`EAS could not be read: ${(error as Error).message}`))
  }
  const { version, seed } = found
  if (!version) return blocked(notChecked(`EAS hasn't reported Version ${versionUid}; it may not be indexed yet`))

  const revokedAt = (a: RawAttestation) => new Date(a.revocationTime * 1000).toISOString()
  const revocation: ArchiveCheck = version.revoked
    ? { status: 'failed', detail: `The Version was revoked at ${revokedAt(version)}` }
    : seed?.revoked
      ? { status: 'failed', detail: `The seed was revoked at ${revokedAt(seed)}` }
      : { status: 'passed', detail: 'The Version and its seed are live on EAS' }
  if (!seed || !sameAddress(seed.attester, version.attester)) {
    return blocked({ status: 'failed', detail: "The Version isn't from its seed's attester" }, revocation)
  }

  const archiveAnchor = asOf === undefined ? found.anchors[0] : found.anchors.find((a) => a.coveredUntil === asOf)
  if (!archiveAnchor) {
    const when = asOf === undefined ? '' : ` for ${new Date(asOf * 1000).toISOString()}`
    return blocked({ status: 'no_anchor', detail: `The Version's attester has no live anchor for it${when}` }, revocation)
  }
  const attestation: AttestationCheck = {
    status: 'passed',
    detail: `Anchored by ${archiveAnchor.attester} at ${new Date(archiveAnchor.timeCreated * 1000).toISOString()}`,
  }

  const fetchTransaction = async (id: string): Promise<Uint8Array | undefined> => {
    for (const gateway of options.gateways ?? DEFAULT_GATEWAYS) {
      try {
        const response = await request(`${gateway.replace(/\/$/, '')}/raw/${id}`, { signal })
        if (response.ok) return new Uint8Array(await response.arrayBuffer())
      } catch (error) {
        rethrowAbort(error)
        // The next gateway may have it.
      }
    }
    return undefined
  }

  // The tag files first: they are small, and Payload-Oxum says how big the rest is.
  let manifest: ReturnType<typeof parsePathManifest>
  let tagFiles: Awaited<ReturnType<typeof readBagFromManifest>>
  let info: Map<string, string>
  try {
    const manifestBytes = await fetchTransaction(archiveAnchor.manifestTx)
    if (!manifestBytes) throw new Error(`Couldn't read manifest ${archiveAnchor.manifestTx}`)
    manifest = parsePathManifest(manifestBytes)
    tagFiles = await readBagFromManifest(manifest, fetchTransaction, { only: isTagFile })
    info = readBagInfo(tagFiles)
  } catch (error) {
    rethrowAbort(error)
    return { ...blocked(attestation, revocation), archiveAnchor, fixity: { ...notChecked((error as Error).message), errors: [] } }
  }

  const oxum = /^(\d+)\.(\d+)$/.exec(info.get('Payload-Oxum') ?? '')
  const size = oxum ? { payloadBytes: Number(oxum[1]), payloadFiles: Number(oxum[2]) } : undefined
  const coveredIso = new Date(archiveAnchor.coveredUntil * 1000).toISOString()
  const namedVersion = info.get('Seed-Version-Uid')
  const identity: ArchiveCheck =
    namedVersion?.toLowerCase() === versionUid.toLowerCase() && info.get('Seed-Bag-As-Of') === coveredIso
      ? { status: 'passed', detail: `The bag is this Version as of ${coveredIso}` }
      : { status: 'failed', detail: `The bag says Version ${namedVersion} as of ${info.get('Seed-Bag-As-Of')}` }
  // The anchored hash covers the tag manifest, which the tag files alone hold.
  const { anchor } = verifyArchive(tagFiles, { expectedTagmanifestSha256: archiveAnchor.tagmanifestSha256 })
  const checked = { attestation, anchor, identity, revocation, timestamp: notChecked('Anchors carry no timestamp proof yet'), archiveAnchor, size }

  if (options.maxBytes !== undefined && (!size || size.payloadBytes > options.maxBytes)) {
    const why = size ? `The payload is ${size.payloadBytes} bytes, over maxBytes` : 'bag-info.txt has no Payload-Oxum to check maxBytes against'
    return { ...checked, fixity: { ...notChecked(why), errors: [] }, record: notChecked(why) }
  }

  let loadedBytes = 0
  const fetchPayload = async (id: string) => {
    const bytes = await fetchTransaction(id)
    if (bytes) {
      loadedBytes += bytes.byteLength
      options.onProgress?.({ loadedBytes, totalBytes: size?.payloadBytes ?? loadedBytes })
    }
    return bytes
  }
  let bag: typeof tagFiles
  try {
    const payload = await readBagFromManifest(manifest, fetchPayload, { only: (path) => !isTagFile(path) })
    bag = { files: [...tagFiles.files, ...payload.files] }
  } catch (error) {
    rethrowAbort(error)
    const why = (error as Error).message
    return { ...checked, fixity: { ...notChecked(why), errors: [] }, record: notChecked(why) }
  }

  const { fixity } = verifyArchive(bag)
  let recorded: ArchiveRecord | undefined
  let record: ArchiveCheck
  try {
    const itemJson = bag.files.find((f) => f.path === 'data/item.json')
    if (!itemJson) throw new Error('The bag has no data/item.json')
    recorded = readRecord(itemJson.bytes)
    record = await checkRecord(recorded, version, { easEndpoint, fetch: request, signal })
  } catch (error) {
    rethrowAbort(error)
    record = notChecked(`The record could not be checked: ${(error as Error).message}`)
  }
  return { ...checked, fixity, record, recorded }
}

/** Every attestation `recorded` names is on `version`, from its attester. */
async function checkRecord(
  recorded: ArchiveRecord,
  version: RawAttestation,
  eas: { easEndpoint: string; fetch: typeof globalThis.fetch; signal?: AbortSignal },
): Promise<ArchiveCheck> {
  if (recorded.versionUid?.toLowerCase() !== version.id.toLowerCase() || recorded.seedUid?.toLowerCase() !== version.refUID.toLowerCase()) {
    return { status: 'failed', detail: `data/item.json names seed ${recorded.seedUid} and Version ${recorded.versionUid}` }
  }
  const uids = [...new Set(Object.values(recorded.attestations))]
  if (uids.length === 0) return notChecked('data/item.json names no attestations')
  let rows: RawAttestation[]
  try {
    rows = await queryAttestations(eas, { id: { in: uids } })
  } catch (error) {
    if (eas.signal?.aborted) throw eas.signal.reason ?? error
    return notChecked(`EAS could not be read: ${(error as Error).message}`)
  }
  const byUid = new Map(rows.map((a) => [a.id.toLowerCase(), a]))
  const wrong = Object.entries(recorded.attestations).filter(([, uid]) => {
    const row = byUid.get(uid.toLowerCase())
    return !row || row.refUID.toLowerCase() !== version.id.toLowerCase() || !sameAddress(row.attester, version.attester)
  })
  return wrong.length === 0
    ? { status: 'passed', detail: `All ${uids.length} attestations in data/item.json are on this Version from its attester` }
    : { status: 'failed', detail: `Not on this Version from its attester: ${wrong.map(([name, uid]) => `${name} (${uid})`).join(', ')}` }
}
