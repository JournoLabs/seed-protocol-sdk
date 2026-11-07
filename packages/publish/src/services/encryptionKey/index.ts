import { SchemaEncoder, NO_EXPIRATION, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import {
  ENCRYPTION_KEY_SCHEMA_DEF,
  ENCRYPTION_KEY_SCHEMA_NAME,
  ENCRYPTION_KEY_SCHEMA_UID,
  arweaveTxIdToBytes32,
  getEncryptionKeysFromEas,
  type EncryptionKeyRegistration,
} from '@seedprotocol/eas'
import { buildArweaveContentTags, getContentSha256, type PublishUploadData } from '@seedprotocol/sdk'
import { bytesToHex, sha256 } from 'viem'
import { getPublishConfig } from '~/config'
import { EncryptionKeySchemaNotRegisteredError } from '~/errors'
import { easAbi } from '~/helpers/abi/eas'
import { getPublishPublicClient, waitForPublishReceipt } from '~/helpers/chainClient'
import { getAttestedUidsFromReceipt, prepareEasAttest, prepareEasMultiRevoke, ZERO_ADDRESS } from '~/helpers/easDirect'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { resolvePublishWallet } from '~/helpers/resolvePublishWallet'
import { dataItemSignerForPublish } from '~/helpers/publishWalletRegistry'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { isPublishWallet, isSeedTxSender, type PublishWallet, type SeedTxSender } from '~/helpers/seedSigner'
import { arweaveBlobStore } from '~/blobStore/arweave'
import { verifyArweaveTransactionsExist } from '../publish/helpers/verifyArweaveTransactionsExist'
import type { PublishMachineContext } from '../../types'

export { ENCRYPTION_KEY_SCHEMA_DEF, ENCRYPTION_KEY_SCHEMA_NAME, ENCRYPTION_KEY_SCHEMA_UID }

/** The key and manifest format this registration describes (`@seedprotocol/encryption` SPEC.md). */
const SUITE = 'seed-private/v1'

export type RegisterEncryptionKeyInput = {
  /** `EncryptionIdentity.keyId`. */
  keyId: string
  /** `EncryptionIdentity.recipient.publicKey`, 1216 bytes. */
  recipientKey: Uint8Array
  /** `EncryptionIdentity.tagKey.publicKey`, 32 bytes. */
  tagKey: Uint8Array
  /** The keystore manifest from `buildKeystoreManifest`. It is uploaded as it is. */
  keystoreManifest: Uint8Array
}

export type RegisterEncryptionKeyOptions = {
  /** The account registering the key: the address that publishes, and so the attester. */
  account: string
  /**
   * Sends the attestation. Its transactions must come from `account` itself (an EOA, a
   * ManagedAccount sender, a 7702 sender). Default the registered wallet. A session key's wallet
   * sends as the session key, so it is refused: registration is the user's action.
   */
  wallet?: PublishWallet
  /** Signs the upload. Default the publish config's, else the wallet's, as a publish does. */
  dataItemSigner?: PublishMachineContext['dataItemSigner']
  signDataItems?: PublishMachineContext['signDataItems']
  publishAuthorization?: PublishMachineContext['publishAuthorization']
}

export type RegisterEncryptionKeyResult = {
  /** The registration attestation. */
  uid: string
  /** The account that attested it. */
  attester: string
  /** Arweave transaction id of the uploaded manifest. */
  keystoreTx: string
  /**
   * The account's earlier live registrations, revoked in one transaction once the new one landed.
   * Empty when there were none, or when listing or revoking them failed (logged); those stay live,
   * and readers still take the newest.
   */
  revokedRegistrationUids: string[]
}

const encoder = new TextEncoder()

/** The key id SPEC.md "Identity" defines: SHA-256 over the label, the recipient key and the tag key. */
function keyIdOf(recipientKey: Uint8Array, tagKey: Uint8Array): string {
  const label = encoder.encode('seed-private/v1/key-id')
  const input = new Uint8Array(label.length + 1 + recipientKey.length + tagKey.length)
  input.set(label, 0)
  input.set(recipientKey, label.length + 1)
  input.set(tagKey, label.length + 1 + recipientKey.length)
  return sha256(input)
}

/** The manifest's bind, read from its second line, or undefined when it isn't an envelope. */
function manifestBind(manifest: Uint8Array): Record<string, unknown> | undefined {
  const head = new TextDecoder().decode(manifest.subarray(0, 4096)).split('\n')
  if (head[0] !== SUITE || !head[1]?.startsWith('bind ')) return undefined
  try {
    const b64 = head[1].slice(5)
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))))
  } catch {
    return undefined
  }
}

function checkInput({ keyId, recipientKey, tagKey, keystoreManifest }: RegisterEncryptionKeyInput) {
  if (recipientKey.length !== 1216) throw new Error('recipientKey must be the 1216-byte X-Wing public key')
  if (tagKey.length !== 32) throw new Error('tagKey must be the 32-byte X25519 public key')
  if (keyIdOf(recipientKey, tagKey) !== keyId) throw new Error(`keyId ${keyId} is not the id of these public keys`)
  const bind = manifestBind(keystoreManifest)
  if (bind?.purpose !== 'keystore' || bind.keyId !== keyId) {
    throw new Error(`keystoreManifest is not a keystore manifest for ${keyId}`)
  }
}

export function encodeEncryptionKeyData(
  input: Pick<RegisterEncryptionKeyInput, 'keyId' | 'recipientKey' | 'tagKey'> & { keystoreTx: string },
): `0x${string}` {
  return new SchemaEncoder(ENCRYPTION_KEY_SCHEMA_DEF).encodeData([
    { name: 'key_id', value: input.keyId, type: 'bytes32' },
    { name: 'suite', value: SUITE, type: 'string' },
    { name: 'recipient_key', value: bytesToHex(input.recipientKey), type: 'bytes' },
    { name: 'tag_key', value: bytesToHex(input.tagKey), type: 'bytes' },
    { name: 'keystore_tx', value: arweaveTxIdToBytes32(input.keystoreTx), type: 'bytes32' },
  ]) as `0x${string}`
}

async function uploadManifest(manifest: Uint8Array, wallet: PublishWallet, options: RegisterEncryptionKeyOptions): Promise<string> {
  const contentHash = getContentSha256(manifest)
  const contentType = 'application/octet-stream'
  // Hash, type and format only: no configured arweaveUploadTags, as for any encrypted upload.
  const upload: PublishUploadData = {
    blob: new Blob([manifest as BlobPart], { type: contentType }),
    contentHash,
    contentType,
    tags: buildArweaveContentTags(contentHash, contentType, [{ name: 'Seed-Encryption', value: SUITE }]),
    itemPropertyName: 'keystore',
    itemPropertyLocalId: '',
    seedLocalId: '',
    versionLocalId: '',
  }
  const config = getPublishConfig()
  const ctx = {
    signDataItems: options.signDataItems ?? config.signDataItems,
    dataItemSigner: options.dataItemSigner ?? config.dataItemSigner ?? dataItemSignerForPublish(wallet, wallet.txSender.address),
    publishAuthorization: options.publishAuthorization,
  }
  const prepared = await arweaveBlobStore.prepare([upload], ctx)
  if (prepared.pending) await arweaveBlobStore.send(prepared.pending, ctx)
  const [id] = prepared.ids
  await verifyArweaveTransactionsExist([id!])
  return id!
}

/**
 * Whether EAS on the publish chain holds `registration` as a live encryption key attestation from
 * `account`, with the data the indexer decoded. Throws when the chain can't be read.
 */
async function isLiveOnChain(registration: EncryptionKeyRegistration, account: string): Promise<boolean> {
  if (registration.suite !== SUITE) return false
  if (keyIdOf(registration.recipientKey, registration.tagKey) !== registration.keyId) return false
  const uid = registration.uid.toLowerCase() as `0x${string}`
  if (!/^0x[0-9a-f]{64}$/.test(uid)) return false
  const onChain = await getPublishPublicClient().readContract({
    address: getPublishConfig().easContractAddress as `0x${string}`,
    abi: easAbi,
    functionName: 'getAttestation',
    args: [uid],
  })
  const now = BigInt(Math.floor(Date.now() / 1000))
  return (
    onChain.uid.toLowerCase() === uid &&
    onChain.schema.toLowerCase() === ENCRYPTION_KEY_SCHEMA_UID &&
    onChain.attester.toLowerCase() === account.toLowerCase() &&
    onChain.revocationTime === 0n &&
    (onChain.expirationTime === 0n || onChain.expirationTime > now) &&
    onChain.data.toLowerCase() === encodeEncryptionKeyData(registration).toLowerCase()
  )
}

/**
 * The encryption key to wrap `account`'s private Versions to: the newest registration the indexer
 * lists that EAS on the publish chain confirms is live, from `account`, with the same data. An
 * indexer that lags or misbehaves can still list a registration that was revoked or name keys the
 * attestation doesn't hold; those are skipped. Undefined when no listed registration passes.
 *
 * The indexer can also leave out a newer registration, which this can't detect.
 * {@link registerEncryptionKey} revokes the earlier registrations when it adds one, so a stale
 * listing finds nothing rather than a replaced key. Throws when the chain can't be read, rather
 * than falling back to an unchecked key.
 */
export async function getVerifiedEncryptionKey({ account }: { account: string }): Promise<EncryptionKeyRegistration | undefined> {
  for (const registration of await getEncryptionKeysFromEas({ attester: account })) {
    if (await isLiveOnChain(registration, account)) return registration
  }
  return undefined
}

/** Revokes `account`'s `earlier` registrations that are still live on chain, other than `keep`. */
async function revokeEarlierRegistrations(
  earlier: EncryptionKeyRegistration[],
  keep: string,
  account: string,
  wallet: PublishWallet,
): Promise<string[]> {
  const live: string[] = []
  for (const registration of earlier) {
    if (registration.uid.toLowerCase() === keep.toLowerCase()) continue
    // EAS reverts the whole multiRevoke on one already revoked, which a stale indexer still lists.
    if (await isLiveOnChain(registration, account)) live.push(registration.uid.toLowerCase())
  }
  if (live.length === 0) return []
  await waitForPublishReceipt(
    (
      await wallet.txSender.sendTransaction(
        prepareEasMultiRevoke([{ schema: ENCRYPTION_KEY_SCHEMA_UID as `0x${string}`, data: live.map((uid) => ({ uid: uid as `0x${string}` })) }]),
      )
    ).transactionHash,
  )
  return live
}

/**
 * Registers an encryption key for the wallet's account (ADR 0033): uploads the keystore manifest
 * to Arweave, then the account attests `seedprotocol.encryptionKey` with the key id, both public
 * keys and the manifest's transaction. Registering again (a new identity, or a revised manifest
 * with another authenticator) makes a new attestation, then revokes the account's earlier live
 * ones in a second transaction, so a reader with a stale indexer listing doesn't wrap to a
 * replaced key. Revoked registrations still name the manifests that open older Versions.
 *
 * Throws {@link EncryptionKeySchemaNotRegisteredError} before uploading when the schema is
 * missing, and refuses inputs whose key id doesn't match the keys or the manifest.
 */
export async function registerEncryptionKey(
  input: RegisterEncryptionKeyInput,
  options: RegisterEncryptionKeyOptions,
): Promise<RegisterEncryptionKeyResult> {
  checkInput(input)
  const wallet = resolvePublishWallet({ wallet: options.wallet })
  const attester = wallet.txSender.address as `0x${string}`
  if (attester.toLowerCase() !== options.account.toLowerCase()) {
    throw new Error(
      `This wallet sends as ${attester}, not as ${options.account}. An encryption key is registered by the account itself, never by a session key.`,
    )
  }
  if (!(await getSchemaRecord(ENCRYPTION_KEY_SCHEMA_UID))) throw new EncryptionKeySchemaNotRegisteredError()

  // Listed before attesting: the indexer may not show the new registration yet, and the earlier
  // ones are what this one replaces.
  const earlier = await getEncryptionKeysFromEas({ attester }).catch((err: unknown) => {
    console.warn('[@seedprotocol/publish] registerEncryptionKey: could not list earlier registrations; none revoked', err)
    return [] as EncryptionKeyRegistration[]
  })

  const keystoreTx = await uploadManifest(input.keystoreManifest, wallet, options)
  const { transactionHash } = await wallet.txSender.sendTransaction(
    prepareEasAttest({
      schema: ENCRYPTION_KEY_SCHEMA_UID,
      data: {
        recipient: ZERO_ADDRESS as `0x${string}`,
        expirationTime: BigInt(NO_EXPIRATION),
        revocable: true,
        refUID: ZERO_BYTES32 as `0x${string}`,
        data: encodeEncryptionKeyData({ ...input, keystoreTx }),
        value: 0n,
      },
    }),
  )
  const receipt = await waitForPublishReceipt(transactionHash)
  const attested = receipt ? getAttestedUidsFromReceipt(receipt, getPublishConfig().easContractAddress, attester) : []
  const created = attested.find((a) => a.schemaUid.toLowerCase() === ENCRYPTION_KEY_SCHEMA_UID)
  if (!created) throw new Error(`Transaction ${transactionHash} made no encryption key attestation from ${attester}`)

  const revokedRegistrationUids = await revokeEarlierRegistrations(earlier, created.uid, attester, wallet).catch((err: unknown) => {
    console.warn('[@seedprotocol/publish] registerEncryptionKey: revoking the earlier registrations failed; they stay live', err)
    return [] as string[]
  })
  return { uid: created.uid, attester, keystoreTx, revokedRegistrationUids }
}

/**
 * Registers the encryption key schema and names it, once per chain, if it's missing. Needs a wallet
 * that can call SchemaRegistry: a session key can't.
 */
export async function ensureEncryptionKeySchema(account: PublishWallet | SeedTxSender): Promise<`0x${string}`> {
  const sender = isPublishWallet(account) ? account.txSender : account
  if (!isSeedTxSender(sender)) throw new Error('@seedprotocol/publish: ensureEncryptionKeySchema requires a PublishWallet or SeedTxSender')
  const schemaUid = ENCRYPTION_KEY_SCHEMA_UID as `0x${string}`
  if (!(await getSchemaRecord(schemaUid))) {
    const send = async (tx: Parameters<SeedTxSender['sendTransaction']>[0]) =>
      waitForPublishReceipt((await sender.sendTransaction(tx)).transactionHash)
    await send(registerSchema({ schema: ENCRYPTION_KEY_SCHEMA_DEF, resolverAddress: ZERO_ADDRESS, revocable: true }))
    await send(prepareNameSchemaAttestation({ schemaUid, schemaName: ENCRYPTION_KEY_SCHEMA_NAME }))
  }
  return schemaUid
}
