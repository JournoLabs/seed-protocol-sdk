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
//   [serialized tags (AVR binary format)]
//   [data]
// ============================================================================

const SIG_TYPE_ETHEREUM = 3
const SIG_LENGTH = 65

const PLACEHOLDER_MESSAGE = new TextEncoder().encode('seed-recovery')

interface Tag {
  name: string
  value: string
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
 * Serialize tags into the ANS-104 AVR binary format.
 * Each tag is: [key length: 2 bytes LE][key bytes][value length: 2 bytes LE][value bytes]
 */
export const serializeTags = (tags: Tag[]): Uint8Array => {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []

  for (const tag of tags) {
    const nameBytes = encoder.encode(tag.name)
    const valueBytes = encoder.encode(tag.value)

    const tagBuf = new Uint8Array(2 + nameBytes.length + 2 + valueBytes.length)
    const view = new DataView(tagBuf.buffer)

    let offset = 0
    view.setUint16(offset, nameBytes.length, true) // LE
    offset += 2
    tagBuf.set(nameBytes, offset)
    offset += nameBytes.length
    view.setUint16(offset, valueBytes.length, true) // LE
    offset += 2
    tagBuf.set(valueBytes, offset)

    parts.push(tagBuf)
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLength)
  let pos = 0
  for (const part of parts) {
    result.set(part, pos)
    pos += part.length
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
 * Build the ANS-104 message bytes (everything from owner onward) that get signed.
 * Format: [owner 65B][target flag 1B][anchor flag 1B][num tags 8B][num tag bytes 8B][tags][data]
 */
function buildMessageBytes(ownerBytes: Uint8Array, tags: Tag[], data: Uint8Array): Uint8Array {
  const serializedTags = serializeTags(tags)
  const numTagsBytes = writeUint64LE(tags.length)
  const numTagBytesBytes = writeUint64LE(serializedTags.length)
  const targetFlag = new Uint8Array([0])
  const anchorFlag = new Uint8Array([0])
  const messageparts = [
    ownerBytes,
    targetFlag,
    anchorFlag,
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
 * Build the "sign data" — everything the signature covers.
 * Per ANS-104: prehash = SHA-384("dataitem") + SHA-384("1") + SHA-384(raw headers + data)
 *
 * But for Ethereum (sig type 3), the convention used by arbundles is to
 * sign the raw message bytes with EIP-191 personal_sign, which prefixes
 * "\x19Ethereum Signed Message:\n{length}" and then keccak256 hashes.
 *
 * We construct the full data item payload (without sig), then sign that.
 */
export const createSignedDataItem = async (
  data: Uint8Array,
  signer: ethers.Wallet,
  tags: Tag[],
): Promise<{ id: string; raw: Uint8Array }> => {
  const pubKeyHex = ethers.SigningKey.computePublicKey(signer.privateKey, false)
  const ownerBytes = ethers.getBytes(pubKeyHex)
  const message = buildMessageBytes(ownerBytes, tags, data)
  const signature = ethers.getBytes(await signer.signMessage(message))
  return assembleDataItemAndId(signature, message)
}

/**
 * Create a signed ANS-104 DataItem using a Thirdweb Account (EOA, ManagedAccount, Modular Account).
 * Uses account.signMessage + public key recovery since Account does not expose privateKey.
 */
export const createSignedDataItemWithAccount = async (
  data: Uint8Array,
  account: Account,
  tags: Tag[],
): Promise<{ id: string; raw: Uint8Array }> => {
  // 1. Recover public key via placeholder sign (Account has no privateKey)
  const placeholderHex = ethers.hexlify(PLACEHOLDER_MESSAGE) as `0x${string}`
  const placeholderSig = await account.signMessage({
    message: { raw: placeholderHex },
  })
  const digest = ethers.hashMessage(PLACEHOLDER_MESSAGE)
  const pubKeyHex = ethers.SigningKey.recoverPublicKey(digest, placeholderSig)
  const ownerBytes = ethers.getBytes(pubKeyHex)

  // 2. Build the real message and sign it
  const message = buildMessageBytes(ownerBytes, tags, data)
  const messageHex = ethers.hexlify(message) as `0x${string}`
  const sigHex = await account.signMessage({
    message: { raw: messageHex },
  })
  const signature = ethers.getBytes(sigHex)

  // 3. Assemble and return
  return assembleDataItemAndId(signature, message)
}

/**
 * Verify an ANS-104 DataItem (Ethereum sig type 3) before upload.
 * Returns true if the signature is valid for the (owner, message) pair.
 */
export async function verifyDataItem(raw: Uint8Array): Promise<boolean> {
  const minLength = 2 + SIG_LENGTH + 65
  if (raw.length < minLength) return false

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const sigType = view.getUint16(0, true)
  if (sigType !== SIG_TYPE_ETHEREUM) return false

  const signature = raw.slice(2, 2 + SIG_LENGTH)
  const message = raw.slice(2 + SIG_LENGTH)
  const ownerBytes = raw.slice(2 + SIG_LENGTH, 2 + SIG_LENGTH + 65)

  try {
    const digest = ethers.hashMessage(message)
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