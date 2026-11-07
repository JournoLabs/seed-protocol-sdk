import { bytes32ToArweaveTxId } from './archiveAnchor.js'
import { ENCRYPTION_KEY_SCHEMA_UID } from './constants.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { withExcludeRevokedFilter } from './easRevokedFilter.js'
import { normalizeBytes32Hex } from './easUid.js'
import { GET_PROPERTIES } from './queries.js'
import { checksumAddresses } from './utils.js'
import type { Attestation } from './graphql/gql/graphql.js'

/** An account's encryption key registration as EAS reports it (ADR 0033). */
export type EncryptionKeyRegistration = {
  uid: string
  attester: string
  /** When it was attested, unix seconds. */
  timeCreated: number
  /** Unix seconds, or 0 while it is live. */
  revocationTime: number
  /** `0x` and 64 lowercase hex digits. */
  keyId: string
  /** Key and manifest format, `seed-private/v1`. */
  suite: string
  /** The X-Wing public key Version file keys are wrapped to. */
  recipientKey: Uint8Array
  /** The X25519 tag public key. */
  tagKey: Uint8Array
  /** Arweave transaction id of the keystore manifest. */
  keystoreTx: string
}

type DecodedField = { name?: string; value?: { value?: unknown } }

function hexBytes(value: unknown): Uint8Array | undefined {
  if (typeof value !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(value)) return undefined
  const out = new Uint8Array((value.length - 2) / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(2 + i * 2, 4 + i * 2), 16)
  return out
}

function decodeRegistration(attestation: Attestation): EncryptionKeyRegistration | undefined {
  try {
    const fields = JSON.parse(attestation.decodedDataJson) as DecodedField[]
    const field = (name: string) => fields.find((f) => f.name === name)?.value?.value
    const keyId = normalizeBytes32Hex(String(field('key_id')))
    const suite = field('suite')
    const recipientKey = hexBytes(field('recipient_key'))
    const tagKey = hexBytes(field('tag_key'))
    if (!keyId || typeof suite !== 'string' || !recipientKey?.length || !tagKey?.length) return undefined
    return {
      uid: attestation.id,
      attester: attestation.attester,
      timeCreated: attestation.timeCreated,
      revocationTime: attestation.revocationTime ?? 0,
      keyId,
      suite,
      recipientKey,
      tagKey,
      keystoreTx: bytes32ToArweaveTxId(String(field('keystore_tx'))),
    }
  } catch {
    return undefined
  }
}

/**
 * `attester`'s encryption key registrations as the indexer reports them, newest first, with
 * registrations from the same second ordered by uid so every reader gets the same order.
 * `includeRevoked` adds revoked ones, whose keystore manifests still open older Versions.
 *
 * To pick the key to wrap to, use `getVerifiedEncryptionKey` from `@seedprotocol/publish`, which
 * checks this list against EAS on chain: an indexer that lags or misbehaves can leave out a newer
 * registration or a revocation. Not cached, so a retry sees what the indexer has now.
 */
export async function getEncryptionKeysFromEas({
  attester,
  includeRevoked = false,
}: {
  attester: string
  includeRevoked?: boolean
}): Promise<EncryptionKeyRegistration[]> {
  const [checksummed] = checksumAddresses([attester])
  const where = { attester: { equals: checksummed }, schemaId: { equals: ENCRYPTION_KEY_SCHEMA_UID } }
  const { itemProperties } = (await BaseEasClient.getEasClient().request(GET_PROPERTIES, {
    where: includeRevoked ? where : withExcludeRevokedFilter(where),
  })) as { itemProperties: Attestation[] }
  return itemProperties
    .filter((a) => a.attester.toLowerCase() === attester.toLowerCase())
    .map(decodeRegistration)
    .filter((r): r is EncryptionKeyRegistration => !!r)
    .sort((a, b) => b.timeCreated - a.timeCreated || (a.uid < b.uid ? 1 : a.uid > b.uid ? -1 : 0))
}
