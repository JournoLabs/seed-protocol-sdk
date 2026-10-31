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

export type VerifyPublishedArchiveOptions = {
  versionUid: string
  /** The EAS GraphQL endpoint of the Version's chain. */
  easEndpoint: string
  /** Read gateways, tried in order. Default arweave.net. */
  gateways?: readonly string[]
  /** Check the anchor of this time, unix seconds. Default the newest. */
  asOf?: number
  /** Default the global `fetch`. */
  fetch?: typeof globalThis.fetch
}

export type PublishedArchiveVerification = Omit<ArchiveVerification, 'tagmanifestSha256'> & {
  /** An anchor exists on the Version, from the attester of the Version and its seed. */
  attestation: ArchiveCheck
  /** The bag says it is this Version at the anchor's time. */
  identity: ArchiveCheck
  /** The Version isn't revoked. A bag says nothing about revocations, so this asks EAS. */
  revocation: ArchiveCheck
  /** A Bitcoin timestamp proof. Anchors have none yet. */
  timestamp: ArchiveCheck
  /** The anchor checked, when there is one. */
  archiveAnchor?: DecodedArchiveAnchor & { uid: string; attester: string; timeCreated: number }
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

/**
 * Finds the Version's anchor, fetches the bag its manifest lays out, and checks the bag against the
 * anchored hash. Doesn't throw for what it finds: a check that couldn't run is `not_checked`, and
 * `detail` says why. An EAS or gateway failure is a `not_checked`, not a `failed`.
 */
export async function verifyPublishedArchive(options: VerifyPublishedArchiveOptions): Promise<PublishedArchiveVerification> {
  const { versionUid, easEndpoint, asOf } = options
  const request = options.fetch ?? globalThis.fetch.bind(globalThis)

  const blocked = (attestation: ArchiveCheck, revocation?: ArchiveCheck): PublishedArchiveVerification => ({
    attestation,
    fixity: { ...notChecked('There is no bag to check'), errors: [] },
    anchor: notChecked('There is no anchored hash to compare with'),
    identity: notChecked('There is no bag to check'),
    revocation: revocation ?? notChecked('The Version could not be read'),
    timestamp: notChecked('Anchors carry no timestamp proof yet'),
  })

  const query = async (where: unknown): Promise<RawAttestation[]> => {
    const response = await request(easEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ATTESTATIONS_QUERY, variables: { where } }),
    })
    if (!response.ok) throw new Error(`EAS answered ${response.status}`)
    const { data } = (await response.json()) as { data?: { attestations?: RawAttestation[] } }
    if (!data?.attestations) throw new Error('EAS answered with no attestations')
    return data.attestations
  }

  let version: RawAttestation | undefined
  let seed: RawAttestation | undefined
  let candidates: RawAttestation[]
  try {
    const rows = await query({
      OR: [{ id: { equals: versionUid } }, { refUID: { equals: versionUid }, schemaId: { equals: ARCHIVE_ANCHOR_SCHEMA_UID } }],
    })
    version = rows.find((a) => a.id.toLowerCase() === versionUid.toLowerCase() && a.schemaId === VERSION_SCHEMA_UID)
    candidates = rows.filter((a) => a.schemaId === ARCHIVE_ANCHOR_SCHEMA_UID)
    if (version) [seed] = await query({ id: { equals: version.refUID } })
  } catch (error) {
    return blocked(notChecked(`EAS could not be read: ${(error as Error).message}`))
  }
  if (!version) return blocked({ status: 'failed', detail: `EAS has no Version ${versionUid}` })

  const revocation: ArchiveCheck = version.revoked
    ? { status: 'failed', detail: `The Version was revoked at ${new Date(version.revocationTime * 1000).toISOString()}` }
    : { status: 'passed', detail: 'The Version is live on EAS' }
  if (!seed || !sameAddress(seed.attester, version.attester)) {
    return blocked({ status: 'failed', detail: "The Version isn't from its seed's attester" }, revocation)
  }

  const anchors = candidates
    .filter((a) => !a.revoked && sameAddress(a.attester, version!.attester))
    .flatMap((a) => {
      const decoded = decodeArchiveAnchorData(a.data)
      return decoded ? [{ ...decoded, uid: a.id, attester: a.attester, timeCreated: a.timeCreated }] : []
    })
  const archiveAnchor = asOf === undefined ? anchors[0] : anchors.find((a) => a.coveredUntil === asOf)
  if (!archiveAnchor) return blocked({ status: 'failed', detail: "The Version's attester has no live anchor for it" }, revocation)
  const attestation: ArchiveCheck = {
    status: 'passed',
    detail: `Anchored by ${archiveAnchor.attester} at ${new Date(archiveAnchor.timeCreated * 1000).toISOString()}`,
  }

  const fetchTransaction = async (id: string): Promise<Uint8Array | undefined> => {
    for (const gateway of options.gateways ?? DEFAULT_GATEWAYS) {
      try {
        const response = await request(`${gateway.replace(/\/$/, '')}/raw/${id}`)
        if (response.ok) return new Uint8Array(await response.arrayBuffer())
      } catch {
        // The next gateway may have it.
      }
    }
    return undefined
  }

  let result: ArchiveVerification
  let info: Map<string, string>
  try {
    const manifest = await fetchTransaction(archiveAnchor.manifestTx)
    if (!manifest) throw new Error(`Couldn't read manifest ${archiveAnchor.manifestTx}`)
    const bag = await readBagFromManifest(parsePathManifest(manifest), fetchTransaction)
    result = verifyArchive(bag, { expectedTagmanifestSha256: archiveAnchor.tagmanifestSha256 })
    info = readBagInfo(bag)
  } catch (error) {
    return { ...blocked(attestation, revocation), archiveAnchor, fixity: { ...notChecked((error as Error).message), errors: [] } }
  }

  const coveredIso = new Date(archiveAnchor.coveredUntil * 1000).toISOString()
  const namedVersion = info.get('Seed-Version-Uid')
  const identity: ArchiveCheck =
    namedVersion?.toLowerCase() === versionUid.toLowerCase() && info.get('Seed-Bag-As-Of') === coveredIso
      ? { status: 'passed', detail: `The bag is this Version as of ${coveredIso}` }
      : { status: 'failed', detail: `The bag says Version ${namedVersion} as of ${info.get('Seed-Bag-As-Of')}` }

  return {
    attestation,
    fixity: result.fixity,
    anchor: result.anchor,
    identity,
    revocation,
    timestamp: notChecked('Anchors carry no timestamp proof yet'),
    archiveAnchor,
  }
}
