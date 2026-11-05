import { ARCHIVE_ANCHOR_SCHEMA_UID } from './constants.js'
import { indexerUid } from './indexerUid.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { decodeEasNumber } from './easValues.js'
import { GET_PROPERTIES } from './queries.js'
import { withExcludeRevokedFilter } from './easRevokedFilter.js'
import { normalizeBytes32Hex } from './easUid.js'
import type { Attestation } from './graphql/gql/graphql.js'

/** A bag anchor as EAS reports it (ADR 0029). */
export type ArchiveAnchor = {
  uid: string
  attester: string
  /** When it was attested, unix seconds. */
  timeCreated: number
  /** The bag's `asOf`, unix seconds. */
  coveredUntil: number
  /** Arweave transaction id of the path manifest. */
  manifestTx: string
  /** Hex SHA-256 of `tagmanifest-sha256.txt`, no `0x`. */
  tagmanifestSha256: string
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** An Arweave transaction id (43 base64url characters, 32 bytes) as a bytes32 hex string. */
export function arweaveTxIdToBytes32(id: string): `0x${string}` {
  if (!/^[a-zA-Z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(id)) throw new Error(`Not an Arweave transaction id: ${id}`)
  let bits = ''
  for (const char of id) bits += BASE64URL.indexOf(char).toString(2).padStart(6, '0')
  let hex = ''
  for (let i = 0; i < 256; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return `0x${hex}`
}

/** Inverse of {@link arweaveTxIdToBytes32}. */
export function bytes32ToArweaveTxId(value: string): string {
  const hex = normalizeBytes32Hex(value).slice(2)
  if (!hex) throw new Error(`Not bytes32: ${value}`)
  let bits = ''
  for (const char of hex) bits += parseInt(char, 16).toString(2).padStart(4, '0')
  bits += '00'
  let id = ''
  for (let i = 0; i < bits.length; i += 6) id += BASE64URL[parseInt(bits.slice(i, i + 6), 2)]
  return id
}

type DecodedField = { name?: string; value?: { value?: unknown } }

function decodeAnchor(attestation: Attestation): ArchiveAnchor | undefined {
  try {
    const fields = JSON.parse(attestation.decodedDataJson) as DecodedField[]
    const field = (name: string) => fields.find((f) => f.name === name)?.value?.value
    const coveredUntil = Number(decodeEasNumber(field('covered_until')))
    const hash = normalizeBytes32Hex(String(field('tagmanifest_sha256')))
    if (!Number.isSafeInteger(coveredUntil) || !hash) return undefined
    return {
      uid: attestation.id,
      attester: attestation.attester,
      timeCreated: attestation.timeCreated,
      coveredUntil,
      manifestTx: bytes32ToArweaveTxId(String(field('manifest_tx'))),
      tagmanifestSha256: hash.slice(2),
    }
  } catch {
    return undefined
  }
}

/**
 * The live anchors of a Version from `attester`, its attester: anyone can attest with any refUID.
 * Newest first. Not cached, so a retry sees what the indexer has now.
 */
export async function getArchiveAnchorsFromEas({
  versionUid,
  attester,
}: {
  versionUid: string
  attester: string
}): Promise<ArchiveAnchor[]> {
  const { itemProperties } = (await BaseEasClient.getEasClient().request(GET_PROPERTIES, {
    where: withExcludeRevokedFilter({
      refUID: { equals: indexerUid(versionUid) },
      schemaId: { equals: ARCHIVE_ANCHOR_SCHEMA_UID },
    }),
  })) as { itemProperties: Attestation[] }
  return itemProperties
    .filter((a) => a.attester.toLowerCase() === attester.toLowerCase())
    .map(decodeAnchor)
    .filter((anchor): anchor is ArchiveAnchor => !!anchor)
    .sort((a, b) => b.timeCreated - a.timeCreated)
}
