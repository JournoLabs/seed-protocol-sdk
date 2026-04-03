import { ethers } from 'ethers'
import type { Account } from 'thirdweb/wallets'

// ============================================================================
// ANS-104 Data Item construction — zero Node.js dependencies
//
// A data item is a binary structure:
//   [signature type (2 bytes)]
//   [signature (65 bytes for Ethereum)]
//   [owner/public key (65 bytes for Ethereum)]
//   [target flag (1 byte) + optional target (32 bytes)]
//   [anchor flag (1 byte) + optional anchor (32 bytes)]
//   [number of tags (8 bytes, little-endian)]
//   [number of tag bytes (8 bytes, little-endian)]
//   [serialized tags (Avro ZigZag VInt format per ANS-104)]
//   [data]
// ============================================================================

const SIG_TYPE_ETHEREUM = 3
const SIG_LENGTH = 65

const PLACEHOLDER_MESSAGE = new TextEncoder().encode('seed-recovery')

interface Tag {
  name: string
  value: string
}

const ANCHOR_LENGTH = 32

/**
 * 32-byte ANS-104 anchor for publish uniqueness (timestamp + signer + nonce).
 * Matches arbundles: presence flag + exactly 32 bytes when set.
 */
const UINT64_MASK = 0xffffffffffffffffn

export function buildPublishAnchorBytes(
  walletAddress: string,
  timestampMs: number,
  uniqueness: bigint,
): Uint8Array {
  const hash = ethers.solidityPackedKeccak256(
    ['uint256', 'address', 'uint64'],
    [BigInt(timestampMs), walletAddress, uniqueness & UINT64_MASK],
  )
  return ethers.getBytes(hash)
}

function encodeTargetOrAnchorSection(raw: Uint8Array): Uint8Array {
  if (raw.length === 0) return new Uint8Array([0])
  if (raw.length !== ANCHOR_LENGTH) {
    throw new Error(`ANS-104 target/anchor must be empty or ${ANCHOR_LENGTH} bytes, got ${raw.length}`)
  }
  const out = new Uint8Array(1 + ANCHOR_LENGTH)
  out[0] = 1
  out.set(raw, 1)
  return out
}

/**
 * Type guard: true if signer is ethers.Wallet (has privateKey). Thirdweb Account does not.
 */
export function isEthersWallet(signer: unknown): signer is ethers.Wallet {
  return (
    signer != null &&
    typeof signer === 'object' &&
    'privateKey' in signer &&
    typeof (signer as ethers.Wallet).privateKey === 'string'
  )
}

/**
 * Write ZigZag-encoded variable-length integer (Avro long format).
 * Used for tag array and per-tag name/value lengths per ANS-104.
 */
function writeZigZagVInt(n: number, out: Uint8Array, offset: number): number {
  const zigzag = n >= 0 ? n << 1 : (~n << 1) | 1
  let m = zigzag
  let pos = offset
  do {
    const byte = m & 0x7f
    m >>>= 7
    out[pos++] = m ? byte | 0x80 : byte
  } while (m)
  return pos - offset
}

/**
 * Serialize tags into ANS-104 Avro format (matches arbundles/Irys).
 * Format: [block count VInt][for each tag: name_len VInt][name][value_len VInt][value]][0 VInt]
 */
export const serializeTags = (tags: Tag[]): Uint8Array => {
  if (!tags?.length) return new Uint8Array(0)

  const encoder = new TextEncoder()
  const temp = new Uint8Array(16)
  const chunks: Uint8Array[] = []

  const appendLong = (n: number) => {
    const len = writeZigZagVInt(n, temp, 0)
    chunks.push(temp.slice(0, len))
  }

  appendLong(tags.length)
  for (const tag of tags) {
    const nameBytes = encoder.encode(tag.name)
    const valueBytes = encoder.encode(tag.value)
    appendLong(nameBytes.length)
    chunks.push(nameBytes)
    appendLong(valueBytes.length)
    chunks.push(valueBytes)
  }
  appendLong(0)

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(totalLength)
  let pos = 0
  for (const chunk of chunks) {
    result.set(chunk, pos)
    pos += chunk.length
  }
  return result
}

/**
 * Write a 64-bit little-endian unsigned integer into a Uint8Array.
 * (Tag counts and byte lengths use 8-byte LE in ANS-104)
 */
export const writeUint64LE = (value: number): Uint8Array => {
  const buf = new Uint8Array(8)
  const view = new DataView(buf.buffer)
  // Safe for values up to Number.MAX_SAFE_INTEGER
  view.setUint32(0, value & 0xffffffff, true)
  view.setUint32(4, Math.floor(value / 0x100000000), true)
  return buf
}

/**
 * Arweave deep-hash (SHA-384 based). Used for ANS-104 DataItem signing.
 * Matches arbundles/Irys getSignatureData flow.
 */
async function sha384(data: Uint8Array): Promise<Uint8Array> {
  // TS 5.9+: Uint8Array<ArrayBufferLike> is not assignable to BufferSource without narrowing
  return new Uint8Array(
    await crypto.subtle.digest('SHA-384', data as BufferSource),
  )
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

async function deepHash(data: Uint8Array | Uint8Array[]): Promise<Uint8Array> {
  const enc = new TextEncoder()
  if (Array.isArray(data)) {
    const tag = concat(enc.encode('list'), enc.encode(data.length.toString()))
    let acc = await sha384(tag)
    for (const chunk of data) {
      const chunkHash = await deepHash(chunk)
      acc = await sha384(concat(acc, chunkHash))
    }
    return acc
  }
  const tag = concat(enc.encode('blob'), enc.encode(data.byteLength.toString()))
  const tagHash = await sha384(tag)
  const dataHash = await sha384(data)
  return sha384(concat(tagHash, dataHash))
}

/**
 * Build the message to sign per ANS-104 / arbundles: deep-hash of DataItem components.
 */
async function getSignatureData(
  ownerBytes: Uint8Array,
  rawTarget: Uint8Array,
  rawAnchor: Uint8Array,
  rawTags: Uint8Array,
  rawData: Uint8Array,
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  return deepHash([
    enc.encode('dataitem'),
    enc.encode('1'),
    enc.encode(SIG_TYPE_ETHEREUM.toString()),
    ownerBytes,
    rawTarget,
    rawAnchor,
    rawTags,
    rawData,
  ])
}

/**
 * Build the ANS-104 message bytes (everything from owner onward) for the raw DataItem.
 */
function buildMessageBytes(
  ownerBytes: Uint8Array,
  tags: Tag[],
  data: Uint8Array,
  rawTarget: Uint8Array,
  rawAnchor: Uint8Array,
): Uint8Array {
  const serializedTags = serializeTags(tags)
  const numTagsBytes = writeUint64LE(tags.length)
  const numTagBytesBytes = writeUint64LE(serializedTags.length)
  const targetSection = encodeTargetOrAnchorSection(rawTarget)
  const anchorSection = encodeTargetOrAnchorSection(rawAnchor)
  const messageparts = [
    ownerBytes,
    targetSection,
    anchorSection,
    numTagsBytes,
    numTagBytesBytes,
    serializedTags,
    data,
  ]
  const messageLength = messageparts.reduce((s, p) => s + p.length, 0)
  const message = new Uint8Array(messageLength)
  let offset = 0
  for (const part of messageparts) {
    message.set(part, offset)
    offset += part.length
  }
  return message
}

/**
 * Assemble the full ANS-104 data item binary and compute its ID.
 * [sig type 2B][signature 65B][owner 65B][...rest of message]
 */
async function assembleDataItemAndId(
  signature: Uint8Array,
  message: Uint8Array,
): Promise<{ id: string; raw: Uint8Array }> {
  const sigTypeBytes = new Uint8Array(2)
  new DataView(sigTypeBytes.buffer).setUint16(0, SIG_TYPE_ETHEREUM, true)
  const fullLength = 2 + SIG_LENGTH + message.length
  const raw = new Uint8Array(fullLength)
  raw.set(sigTypeBytes, 0)
  raw.set(signature, 2)
  raw.set(message, 2 + SIG_LENGTH)
  const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(signature))
  const id = base64url(new Uint8Array(hashBuffer))
  return { id, raw }
}

/**
 * Create a signed ANS-104 DataItem. Uses deep-hash for the message to sign (per arbundles/Irys).
 */
export const createSignedDataItem = async (
  data: Uint8Array,
  signer: ethers.Wallet,
  tags: Tag[],
  rawAnchor: Uint8Array = new Uint8Array(0),
): Promise<{ id: string; raw: Uint8Array }> => {
  const pubKeyHex = ethers.SigningKey.computePublicKey(signer.privateKey, false)
  const ownerBytes = ethers.getBytes(pubKeyHex)
  const serializedTags = serializeTags(tags)
  const rawTarget = new Uint8Array(0)

  const signatureData = await getSignatureData(
    ownerBytes,
    rawTarget,
    rawAnchor,
    serializedTags,
    data,
  )
  const signature = ethers.getBytes(await signer.signMessage(signatureData))

  const message = buildMessageBytes(ownerBytes, tags, data, rawTarget, rawAnchor)
  return assembleDataItemAndId(signature, message)
}

/**
 * Create a signed ANS-104 DataItem using a Thirdweb Account (EOA, ManagedAccount, Modular Account).
 * Uses deep-hash for the message to sign (per arbundles/Irys).
 */
export const createSignedDataItemWithAccount = async (
  data: Uint8Array,
  account: Account,
  tags: Tag[],
  rawAnchor: Uint8Array = new Uint8Array(0),
): Promise<{ id: string; raw: Uint8Array }> => {
  // 1. Recover public key via placeholder sign (Account has no privateKey)
  const placeholderHex = ethers.hexlify(PLACEHOLDER_MESSAGE) as `0x${string}`
  const placeholderSig = await account.signMessage({
    message: { raw: placeholderHex },
  })
  const digest = ethers.hashMessage(PLACEHOLDER_MESSAGE)
  const pubKeyHex = ethers.SigningKey.recoverPublicKey(digest, placeholderSig)
  const ownerBytes = ethers.getBytes(pubKeyHex)

  // 2. Build signature data (deep-hash) and sign it
  const serializedTags = serializeTags(tags)
  const rawTarget = new Uint8Array(0)
  const signatureData = await getSignatureData(
    ownerBytes,
    rawTarget,
    rawAnchor,
    serializedTags,
    data,
  )
  const signatureDataHex = ethers.hexlify(signatureData) as `0x${string}`
  const sigHex = await account.signMessage({
    message: { raw: signatureDataHex },
  })
  const signature = ethers.getBytes(sigHex)

  // 3. Assemble and return
  const message = buildMessageBytes(ownerBytes, tags, data, rawTarget, rawAnchor)
  return assembleDataItemAndId(signature, message)
}

const OWNER_LENGTH_ETHEREUM = 65

/**
 * Byte offset of the tags section (8-byte tag count + 8-byte tag bytes length + tags + data).
 * Mirrors arbundles DataItem.getTagsStart / getAnchorStart.
 */
function getTagsStartOffset(raw: Uint8Array): number | null {
  const targetStart = 2 + SIG_LENGTH + OWNER_LENGTH_ETHEREUM
  if (raw.length < targetStart + 1) return null
  const targetFlag = raw[targetStart]!
  if (targetFlag !== 0 && targetFlag !== 1) return null
  const targetPresent = targetFlag === 1
  if (targetPresent && raw.length < targetStart + 33) return null
  let pos = targetStart + (targetPresent ? 33 : 1)
  if (raw.length < pos + 1) return null
  const anchorFlag = raw[pos]!
  if (anchorFlag !== 0 && anchorFlag !== 1) return null
  const anchorPresent = anchorFlag === 1
  if (anchorPresent && raw.length < pos + 33) return null
  return pos + (anchorPresent ? 33 : 1)
}

function sliceTargetAndAnchor(
  raw: Uint8Array,
): { rawTarget: Uint8Array; rawAnchor: Uint8Array; tagsStart: number } | null {
  const tagsStart = getTagsStartOffset(raw)
  if (tagsStart == null) return null
  const targetStart = 2 + SIG_LENGTH + OWNER_LENGTH_ETHEREUM
  const targetPresent = raw[targetStart] === 1
  const rawTarget = targetPresent ? raw.slice(targetStart + 1, targetStart + 33) : new Uint8Array(0)
  const anchorStart = targetStart + (targetPresent ? 33 : 1)
  const anchorPresent = raw[anchorStart] === 1
  const rawAnchor = anchorPresent ? raw.slice(anchorStart + 1, anchorStart + 33) : new Uint8Array(0)
  return { rawTarget, rawAnchor, tagsStart }
}

/**
 * Verify an ANS-104 DataItem (Ethereum sig type 3) before upload.
 * Uses deep-hash for the expected message (per arbundles/Irys).
 */
export async function verifyDataItem(raw: Uint8Array): Promise<boolean> {
  const parsed = sliceTargetAndAnchor(raw)
  if (parsed == null) return false
  const { rawTarget, rawAnchor, tagsStart } = parsed
  const minLength = tagsStart + 16
  if (raw.length < minLength) return false

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const sigType = view.getUint16(0, true)
  if (sigType !== SIG_TYPE_ETHEREUM) return false

  const signature = raw.slice(2, 2 + SIG_LENGTH)
  const ownerBytes = raw.slice(2 + SIG_LENGTH, 2 + SIG_LENGTH + OWNER_LENGTH_ETHEREUM)

  const numTagBytes = Number(
    view.getUint32(tagsStart + 8, true) + view.getUint32(tagsStart + 12, true) * 0x100000000
  )
  const tagsEnd = tagsStart + 16 + numTagBytes
  if (raw.length < tagsEnd) return false

  const rawTags = raw.slice(tagsStart + 16, tagsEnd)
  const rawData = raw.slice(tagsEnd)

  try {
    const signatureData = await getSignatureData(
      ownerBytes,
      rawTarget,
      rawAnchor,
      rawTags,
      rawData,
    )
    const digest = ethers.hashMessage(signatureData)
    const sigHex = ethers.hexlify(signature)
    const recoveredPubKey = ethers.SigningKey.recoverPublicKey(digest, sigHex)
    const recoveredBytes = ethers.getBytes(recoveredPubKey)
    return (
      recoveredBytes.length === ownerBytes.length &&
      recoveredBytes.every((b, i) => b === ownerBytes[i])
    )
  } catch {
    return false
  }
}

/**
 * Base64url encode (no padding) — used for data item IDs
 */
export const base64url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}