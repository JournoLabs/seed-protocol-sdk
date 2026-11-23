import { SchemaEncoder, NO_EXPIRATION, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import {
  INCLUSION_SCHEMA_DEF,
  INCLUSION_SCHEMA_NAME,
  INCLUSION_SCHEMA_UID,
  STAFF_SCHEMA_DEF,
  STAFF_SCHEMA_NAME,
  STAFF_SCHEMA_UID,
  VERSION_SCHEMA_UID,
} from '@seedprotocol/eas'
import { getPublishConfig } from '~/config'
import { PairSchemaNotRegisteredError } from '~/errors'
import { easAbi } from '~/helpers/abi/eas'
import { getPublishPublicClient, waitForPublishReceipt } from '~/helpers/chainClient'
import { getAttestedUidsFromReceipt, prepareEasAttest, prepareEasMultiRevoke, ZERO_ADDRESS } from '~/helpers/easDirect'
import { prepareNameSchemaAttestation } from '~/helpers/nameSchemaAttestation'
import { resolvePublishWallet } from '~/helpers/resolvePublishWallet'
import { getSchemaRecord, registerSchema } from '~/helpers/schemaRegistry'
import { isPublishWallet, isSeedTxSender, type PublishWallet, type SeedTxSender } from '~/helpers/seedSigner'

export {
  INCLUSION_SCHEMA_DEF,
  INCLUSION_SCHEMA_NAME,
  INCLUSION_SCHEMA_UID,
  STAFF_SCHEMA_DEF,
  STAFF_SCHEMA_NAME,
  STAFF_SCHEMA_UID,
}

type Hex = `0x${string}`

/** What a half helper returns: the new attestation and the values it was sent with. */
export type AttestPairHalfResult = {
  uid: Hex
  schemaUid: Hex
  /** The attester of the other side's seed. */
  recipient: Hex
  /** The half this one answers or updates, or zero. */
  refUid: Hex
}

export type AttestInclusionHalfParams = {
  /** Sends as the half's attester: the account itself, never an automation session key. */
  wallet?: PublishWallet
  publicationUid: string
  postUid: string
} & (
  | {
      /** By the post seed's attester. Names no Version: the author agrees to be in the publication. */
      half: 'author'
      /** The owner half this one answers. Omit to make an offer. */
      refUid?: string
    }
  | {
      /** By the publication seed's attester. */
      half: 'owner'
      /** The Version of the post the owner pins: live, by the post seed's attester. */
      versionUid: string
      /** The author half this one answers or updates. Omit to make an ask. */
      refUid?: string
    }
)

export type AttestStaffHalfParams = {
  /** Sends as the half's attester: the account itself, never an automation session key. */
  wallet?: PublishWallet
  publicationUid: string
  identityUid: string
} & (
  | {
      /** By the publication seed's attester: the ask. */
      half: 'owner'
    }
  | {
      /** By the identity seed's attester: the agreement. */
      half: 'person'
      /** The owner half this one answers. */
      refUid: string
    }
)

export type RevokePairHalfParams = {
  /** Sends as the half's attester. */
  wallet?: PublishWallet
  uid: string
}

type OnChainAttestation = {
  uid: Hex
  schema: Hex
  refUID: Hex
  attester: Hex
  revocationTime: bigint
  data: Hex
}

const HEX32 = /^0x[0-9a-f]{64}$/

function uidParam(value: string, name: string): Hex {
  const uid = value.trim().toLowerCase()
  if (!HEX32.test(uid) || uid === ZERO_BYTES32) throw new Error(`${name} must be an attestation uid, got ${JSON.stringify(value)}`)
  return uid as Hex
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The attestation `uid` as EAS on the publish chain holds it; undefined when there is none. */
async function readAttestation(uid: Hex): Promise<OnChainAttestation | undefined> {
  const onChain = (await getPublishPublicClient().readContract({
    address: getPublishConfig().easContractAddress as Hex,
    abi: easAbi,
    functionName: 'getAttestation',
    args: [uid],
  })) as OnChainAttestation
  return onChain.uid.toLowerCase() === uid ? onChain : undefined
}

/** The live attestation `uid`, or an error naming `what` it should have been. */
async function readLive(uid: Hex, what: string): Promise<OnChainAttestation> {
  const onChain = await readAttestation(uid)
  if (!onChain) throw new Error(`${what} ${uid} is not on this chain.`)
  if (onChain.revocationTime !== 0n) throw new Error(`${what} ${uid} is revoked.`)
  return onChain
}

function decodeFields(definition: string, data: Hex): Record<string, string> {
  return Object.fromEntries(
    new SchemaEncoder(definition).decodeData(data).map((f) => [f.name, String(f.value.value).toLowerCase()]),
  )
}

/** Refuses a wallet that doesn't send as `attester`, such as a session key. */
function senderFor(wallet: PublishWallet | undefined, attester: string, half: string, seed: string): PublishWallet {
  const resolved = resolvePublishWallet({ wallet })
  const sender = resolved.txSender.address
  if (!sameAddress(sender, attester)) {
    throw new Error(
      `This wallet sends as ${sender}, but the ${half} half is attested by the ${seed} seed's attester, ${attester}. Send it from that account, never from a session key.`,
    )
  }
  return resolved
}

async function requireSchema(schemaUid: string, schemaName: string): Promise<void> {
  if (!(await getSchemaRecord(schemaUid))) throw new PairSchemaNotRegisteredError(schemaName)
}

async function attest(wallet: PublishWallet, schemaUid: Hex, recipient: Hex, refUid: Hex, data: Hex): Promise<AttestPairHalfResult> {
  const { transactionHash } = await wallet.txSender.sendTransaction(
    prepareEasAttest({
      schema: schemaUid,
      data: { recipient, expirationTime: BigInt(NO_EXPIRATION), revocable: true, refUID: refUid, data, value: 0n },
    }),
  )
  const receipt = await waitForPublishReceipt(transactionHash)
  const attested = receipt ? getAttestedUidsFromReceipt(receipt, getPublishConfig().easContractAddress, wallet.txSender.address) : []
  const created = attested.find((a) => a.schemaUid.toLowerCase() === schemaUid)
  if (!created) throw new Error(`Transaction ${transactionHash} made no attestation under ${schemaUid} from ${wallet.txSender.address}`)
  return { uid: created.uid.toLowerCase() as Hex, schemaUid, recipient, refUid }
}

/** Both seeds, live and with different attesters. */
async function readSides(left: { uid: Hex; what: string }, right: { uid: Hex; what: string }) {
  const [a, b] = await Promise.all([readLive(left.uid, `The ${left.what} seed`), readLive(right.uid, `The ${right.what} seed`)])
  if (sameAddress(a.attester, b.attester)) {
    throw new Error(
      `The ${left.what} and the ${right.what} have the same attester, ${a.attester}. A pair needs two sides; the owner's own ${right.what} needs no halves.`,
    )
  }
  return [a, b] as const
}

export function encodeInclusionData(fields: { publicationUid: string; postUid: string; versionUid?: string }): Hex {
  return new SchemaEncoder(INCLUSION_SCHEMA_DEF).encodeData([
    { name: 'publication', value: fields.publicationUid, type: 'bytes32' },
    { name: 'post', value: fields.postUid, type: 'bytes32' },
    { name: 'version', value: fields.versionUid ?? ZERO_BYTES32, type: 'bytes32' },
  ]) as Hex
}

export function encodeStaffData(fields: { publicationUid: string; identityUid: string }): Hex {
  return new SchemaEncoder(STAFF_SCHEMA_DEF).encodeData([
    { name: 'publication', value: fields.publicationUid, type: 'bytes32' },
    { name: 'identity', value: fields.identityUid, type: 'bytes32' },
  ]) as Hex
}

/**
 * Attests one half of an Inclusion of a post in a publication. The author half is by the post
 * seed's attester; the owner half by the publication seed's attester, naming the Version it pins.
 * The half's recipient is the other side's seed attester, and its refUID the half it answers.
 *
 * Reads the seeds, the Version and the referenced half from the chain and refuses before sending
 * when the wallet isn't the half's attester, both seeds have one attester, the Version isn't a
 * live Version of the post by its attester, or the referenced half isn't a live Inclusion half
 * from the other side naming the same publication and post. Throws
 * {@link PairSchemaNotRegisteredError} when the schema is missing.
 */
export async function attestInclusionHalf(params: AttestInclusionHalfParams): Promise<AttestPairHalfResult> {
  const publicationUid = uidParam(params.publicationUid, 'publicationUid')
  const postUid = uidParam(params.postUid, 'postUid')
  const refUid = params.refUid === undefined ? (ZERO_BYTES32 as Hex) : uidParam(params.refUid, 'refUid')
  const versionUid = params.half === 'owner' ? uidParam(params.versionUid, 'versionUid') : undefined
  if (params.half === 'author' && 'versionUid' in params && (params as { versionUid?: unknown }).versionUid !== undefined) {
    throw new Error('An author half names no Version: the owner half pins the Version.')
  }

  const [publication, post] = await readSides({ uid: publicationUid, what: 'publication' }, { uid: postUid, what: 'post' })
  const [own, other] = params.half === 'author' ? [post, publication] : [publication, post]
  const wallet = senderFor(params.wallet, own.attester, params.half, params.half === 'author' ? 'post' : 'publication')

  if (versionUid) {
    const version = await readLive(versionUid, 'The Version')
    if (
      version.schema.toLowerCase() !== VERSION_SCHEMA_UID ||
      version.refUID.toLowerCase() !== postUid ||
      !sameAddress(version.attester, post.attester)
    ) {
      throw new Error(`${versionUid} is not a Version of post ${postUid} by its attester, ${post.attester}.`)
    }
  }

  if (refUid !== ZERO_BYTES32) {
    const otherHalf = params.half === 'author' ? 'owner' : 'author'
    const referenced = await readLive(refUid, `The ${otherHalf} half`)
    const fields = referenced.schema.toLowerCase() === INCLUSION_SCHEMA_UID ? decodeFields(INCLUSION_SCHEMA_DEF, referenced.data) : undefined
    if (
      !fields ||
      !sameAddress(referenced.attester, other.attester) ||
      fields.publication !== publicationUid ||
      fields.post !== postUid
    ) {
      throw new Error(
        `${refUid} is not an Inclusion ${otherHalf} half by ${other.attester} for publication ${publicationUid} and post ${postUid}.`,
      )
    }
  }

  await requireSchema(INCLUSION_SCHEMA_UID, INCLUSION_SCHEMA_NAME)
  return attest(
    wallet,
    INCLUSION_SCHEMA_UID as Hex,
    other.attester.toLowerCase() as Hex,
    refUid,
    encodeInclusionData({ publicationUid, postUid, versionUid }),
  )
}

/**
 * Attests one half of Staff: an identity named in a publication. The owner half (the ask) is by
 * the publication seed's attester, with refUID zero; the person half by the identity seed's
 * attester, answering the owner half. The half's recipient is the other side's seed attester.
 *
 * Refuses before sending when the wallet isn't the half's attester, both seeds have one attester,
 * or the owner half a person half answers isn't a live Staff owner half by the publication's
 * attester naming the same publication and identity. Throws {@link PairSchemaNotRegisteredError}
 * when the schema is missing.
 */
export async function attestStaffHalf(params: AttestStaffHalfParams): Promise<AttestPairHalfResult> {
  const publicationUid = uidParam(params.publicationUid, 'publicationUid')
  const identityUid = uidParam(params.identityUid, 'identityUid')
  const refUid = params.half === 'person' ? uidParam(params.refUid ?? '', 'refUid') : (ZERO_BYTES32 as Hex)

  const [publication, identity] = await readSides({ uid: publicationUid, what: 'publication' }, { uid: identityUid, what: 'identity' })
  const [own, other] = params.half === 'person' ? [identity, publication] : [publication, identity]
  const wallet = senderFor(params.wallet, own.attester, params.half, params.half === 'person' ? 'identity' : 'publication')

  if (params.half === 'person') {
    const ask = await readLive(refUid, 'The owner half')
    const fields = ask.schema.toLowerCase() === STAFF_SCHEMA_UID ? decodeFields(STAFF_SCHEMA_DEF, ask.data) : undefined
    if (!fields || !sameAddress(ask.attester, publication.attester) || fields.publication !== publicationUid || fields.identity !== identityUid) {
      throw new Error(
        `${refUid} is not a Staff owner half by ${publication.attester} for publication ${publicationUid} and identity ${identityUid}.`,
      )
    }
  }

  await requireSchema(STAFF_SCHEMA_UID, STAFF_SCHEMA_NAME)
  return attest(wallet, STAFF_SCHEMA_UID as Hex, other.attester.toLowerCase() as Hex, refUid, encodeStaffData({ publicationUid, identityUid }))
}

async function revokeHalf(params: RevokePairHalfParams, schemaUid: string, schemaLabel: string): Promise<void> {
  const uid = uidParam(params.uid, 'uid')
  const half = await readLive(uid, `The ${schemaLabel} half`)
  if (half.schema.toLowerCase() !== schemaUid) throw new Error(`${uid} is not a ${schemaLabel} half.`)
  const wallet = resolvePublishWallet({ wallet: params.wallet })
  if (!sameAddress(wallet.txSender.address, half.attester)) {
    throw new Error(`This wallet sends as ${wallet.txSender.address}; only the half's attester, ${half.attester}, can revoke it.`)
  }
  const { transactionHash } = await wallet.txSender.sendTransaction(
    prepareEasMultiRevoke([{ schema: schemaUid as Hex, data: [{ uid }] }]),
  )
  await waitForPublishReceipt(transactionHash)
}

/** Revokes an Inclusion half, which ends the pair. Only the half's attester can. */
export async function revokeInclusionHalf(params: RevokePairHalfParams): Promise<void> {
  await revokeHalf(params, INCLUSION_SCHEMA_UID, 'Inclusion')
}

/** Revokes a Staff half, which ends the pair. Only the half's attester can. */
export async function revokeStaffHalf(params: RevokePairHalfParams): Promise<void> {
  await revokeHalf(params, STAFF_SCHEMA_UID, 'Staff')
}

async function ensureSchema(account: PublishWallet | SeedTxSender, definition: string, schemaUid: string, schemaName: string): Promise<Hex> {
  const sender = isPublishWallet(account) ? account.txSender : account
  if (!isSeedTxSender(sender)) throw new Error(`@seedprotocol/publish: registering ${schemaName} requires a PublishWallet or SeedTxSender`)
  if (!(await getSchemaRecord(schemaUid))) {
    const send = async (tx: Parameters<SeedTxSender['sendTransaction']>[0]) =>
      waitForPublishReceipt((await sender.sendTransaction(tx)).transactionHash)
    await send(registerSchema({ schema: definition, resolverAddress: ZERO_ADDRESS, revocable: true }))
    await send(prepareNameSchemaAttestation({ schemaUid, schemaName }))
  }
  return schemaUid as Hex
}

/**
 * Registers the Inclusion schema and names it, once per chain, if it's missing. Needs a wallet
 * that can call SchemaRegistry: a session key can't.
 */
export async function ensureInclusionSchema(account: PublishWallet | SeedTxSender): Promise<Hex> {
  return ensureSchema(account, INCLUSION_SCHEMA_DEF, INCLUSION_SCHEMA_UID, INCLUSION_SCHEMA_NAME)
}

/**
 * Registers the Staff schema and names it, once per chain, if it's missing. Needs a wallet that can
 * call SchemaRegistry: a session key can't.
 */
export async function ensureStaffSchema(account: PublishWallet | SeedTxSender): Promise<Hex> {
  return ensureSchema(account, STAFF_SCHEMA_DEF, STAFF_SCHEMA_UID, STAFF_SCHEMA_NAME)
}
