import { SchemaEncoder, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import {
  LICENSE_OFFER_SCHEMA_DEF,
  LICENSE_OFFER_SCHEMA_NAME,
  LICENSE_OFFER_SCHEMA_UID,
  arweaveTxIdToBytes32,
} from '@seedprotocol/eas'
import { InvalidLicenseOfferError } from '~/errors'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { ZERO_ADDRESS } from '~/helpers/easDirect'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { isPublishWallet, isSeedTxSender, type PublishWallet, type SeedTxSender } from '~/helpers/seedSigner'

export { LICENSE_OFFER_SCHEMA_DEF, LICENSE_OFFER_SCHEMA_NAME, LICENSE_OFFER_SCHEMA_UID }

/**
 * A license offer sent with a publish (ADR 0039). Take `termsHash` and `spdx` from a
 * `@seedprotocol/licensing` catalog module: `termsHash(module.toTerms())` and `module.spdx`.
 */
export type LicenseOfferInput = {
  /** `termsHash` of the license terms: `0x` and 64 hex digits. */
  termsHash: string
  /** The license's SPDX id or expression, for readers without the catalog. */
  spdx: string
  /** Arweave transaction id of the legal text, when it has one. */
  legalTxId?: string
}

/** The offer's entry in a publish request's `listOfAttestations`, marked so its uid isn't read as a property's. */
export type LicenseOfferAttestation = {
  schema: `0x${string}`
  data: Array<{
    recipient: `0x${string}`
    expirationTime: bigint
    revocable: boolean
    refUID: `0x${string}`
    data: `0x${string}`
    value: bigint
  }>
  _licenseOffer: true
}

/**
 * `offer` checked and normalized: `termsHash` in lower case, `spdx` trimmed.
 * @throws InvalidLicenseOfferError
 */
export function parseLicenseOffer(offer: unknown): LicenseOfferInput {
  const o = offer as Partial<LicenseOfferInput> | null
  if (!o || typeof o !== 'object') throw new InvalidLicenseOfferError('licenseOffer must be an object with termsHash and spdx.')
  if (typeof o.termsHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(o.termsHash)) {
    throw new InvalidLicenseOfferError(`licenseOffer.termsHash must be 0x and 64 hex digits, got ${String(o.termsHash)}.`)
  }
  if (typeof o.spdx !== 'string' || o.spdx.trim() === '') {
    throw new InvalidLicenseOfferError('licenseOffer.spdx must name the license.')
  }
  if (o.legalTxId !== undefined) {
    try {
      arweaveTxIdToBytes32(o.legalTxId)
    } catch {
      throw new InvalidLicenseOfferError(`licenseOffer.legalTxId is not an Arweave transaction id: ${String(o.legalTxId)}.`)
    }
  }
  return {
    termsHash: o.termsHash.toLowerCase(),
    spdx: o.spdx.trim(),
    ...(o.legalTxId !== undefined ? { legalTxId: o.legalTxId } : {}),
  }
}

/** Encodes a free offer: every field after `legal_tx` is zero. */
export function encodeLicenseOfferData(offer: LicenseOfferInput): `0x${string}` {
  return new SchemaEncoder(LICENSE_OFFER_SCHEMA_DEF).encodeData([
    { name: 'terms_hash', value: offer.termsHash, type: 'bytes32' },
    { name: 'spdx', value: offer.spdx, type: 'string' },
    { name: 'legal_tx', value: offer.legalTxId ? arweaveTxIdToBytes32(offer.legalTxId) : ZERO_BYTES32, type: 'bytes32' },
    { name: 'price', value: 0n, type: 'uint256' },
    { name: 'currency', value: ZERO_ADDRESS, type: 'address' },
    { name: 'payee', value: ZERO_ADDRESS, type: 'address' },
    { name: 'duration', value: 0n, type: 'uint64' },
    { name: 'max_grants', value: 0n, type: 'uint64' },
    { name: 'access_policy', value: ZERO_BYTES32, type: 'bytes32' },
    { name: 'gate_hook', value: ZERO_ADDRESS, type: 'address' },
  ]) as `0x${string}`
}

/**
 * The offer as one more entry of the root request. `refUID` zero is what `multiPublish` reads as the
 * batch's Version; direct EAS sets the Version itself.
 */
export function licenseOfferAttestation(
  offer: LicenseOfferInput,
  refUID: `0x${string}` = ZERO_BYTES32 as `0x${string}`,
): LicenseOfferAttestation {
  return {
    schema: LICENSE_OFFER_SCHEMA_UID as `0x${string}`,
    data: [
      {
        recipient: ZERO_ADDRESS as `0x${string}`,
        expirationTime: 0n,
        revocable: true,
        refUID,
        data: encodeLicenseOfferData(offer),
        value: 0n,
      },
    ],
    _licenseOffer: true,
  }
}

/**
 * Registers the license offer schema and names it, once per chain, if it's missing. Any wallet can
 * register it (ADR 0035), but a session key can't call SchemaRegistry.
 */
export async function ensureLicenseOfferSchema(account: PublishWallet | SeedTxSender): Promise<`0x${string}`> {
  const sender = isPublishWallet(account) ? account.txSender : account
  if (!isSeedTxSender(sender)) throw new Error('@seedprotocol/publish: ensureLicenseOfferSchema requires a PublishWallet or SeedTxSender')
  const schemaUid = LICENSE_OFFER_SCHEMA_UID as `0x${string}`
  if (!(await getSchemaRecord(schemaUid))) {
    const send = async (tx: Parameters<SeedTxSender['sendTransaction']>[0]) =>
      waitForPublishReceipt((await sender.sendTransaction(tx)).transactionHash)
    await send(registerSchema({ schema: LICENSE_OFFER_SCHEMA_DEF, resolverAddress: ZERO_ADDRESS, revocable: true }))
    await send(prepareNameSchemaAttestation({ schemaUid, schemaName: LICENSE_OFFER_SCHEMA_NAME }))
  }
  return schemaUid
}
