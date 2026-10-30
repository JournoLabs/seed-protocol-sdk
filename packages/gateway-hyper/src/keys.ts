import fs from 'node:fs'
import path from 'node:path'
import HyperDHT from 'hyperdht'
import ID from 'hypercore-id-encoding'
import type { OperatorKeyPair } from './types'

export interface PersistedKeyFile {
  publicKey: string
  secretKey: string
  encoding: 'hex'
}

function toHex(buf: Buffer): string {
  return buf.toString('hex')
}

function fromHex(hex: string): Buffer {
  return Buffer.from(hex, 'hex')
}

export function encodePublicKeyZ32(publicKey: Buffer): string {
  return ID.encode(publicKey)
}

export function decodePublicKey(key: string): Buffer {
  const trimmed = key.trim()
  if (!trimmed) {
    throw new Error('Gateway Hyper key is empty')
  }
  try {
    return Buffer.from(ID.decode(trimmed))
  } catch {
    if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
      return fromHex(trimmed)
    }
    throw new Error(`Invalid Gateway Hyper key (expected z32 or 64-char hex): ${trimmed.slice(0, 12)}…`)
  }
}

export function loadOrCreateOperatorKeypair(keyFile: string): OperatorKeyPair {
  const resolved = path.resolve(keyFile)
  if (fs.existsSync(resolved)) {
    const raw = fs.readFileSync(resolved, 'utf8')
    const parsed = JSON.parse(raw) as PersistedKeyFile
    if (!parsed.publicKey || !parsed.secretKey) {
      throw new Error(`Invalid key file at ${resolved}: missing publicKey or secretKey`)
    }
    const publicKey = fromHex(parsed.publicKey)
    const secretKey = fromHex(parsed.secretKey)
    return {
      publicKey,
      secretKey,
      z32: encodePublicKeyZ32(publicKey),
    }
  }

  const dir = path.dirname(resolved)
  fs.mkdirSync(dir, { recursive: true })
  const kp = HyperDHT.keyPair()
  const persisted: PersistedKeyFile = {
    publicKey: toHex(kp.publicKey),
    secretKey: toHex(kp.secretKey),
    encoding: 'hex',
  }
  fs.writeFileSync(resolved, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 })
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    z32: encodePublicKeyZ32(kp.publicKey),
  }
}

/** Check a keypair passed in code and add its z32 key. */
export function toOperatorKeypair(keyPair: { publicKey: Buffer; secretKey: Buffer }): OperatorKeyPair {
  const { publicKey, secretKey } = keyPair
  if (publicKey?.length !== 32 || secretKey?.length !== 64) {
    throw new Error('Invalid keyPair: expected a 32-byte publicKey and a 64-byte secretKey')
  }
  // An Ed25519 secret key in libsodium form is the seed followed by the public key.
  if (!Buffer.from(secretKey.subarray(32)).equals(Buffer.from(publicKey))) {
    throw new Error('Invalid keyPair: publicKey does not belong to secretKey')
  }
  return { publicKey, secretKey, z32: encodePublicKeyZ32(publicKey) }
}

/**
 * The keypair a client presents to the operator: `keyPair` if given, else the one in
 * `keyFile` (created on first use), else a new one for this run only.
 */
export function resolveClientKeypair(options: {
  keyFile?: string
  keyPair?: { publicKey: Buffer; secretKey: Buffer }
}): OperatorKeyPair {
  if (options.keyFile && options.keyPair) {
    throw new Error('Pass keyFile or keyPair, not both')
  }
  if (options.keyPair) return toOperatorKeypair(options.keyPair)
  if (options.keyFile) return loadOrCreateOperatorKeypair(options.keyFile)
  return createEphemeralClientKeypair()
}

/**
 * The operator's keypair: `keyPair` if given, else the one in `keyFile` (`defaultKeyFile` when
 * unset), created on first use. Passing both throws, as for a client.
 */
export function resolveOperatorKeypair(
  options: { keyFile?: string; keyPair?: { publicKey: Buffer; secretKey: Buffer } },
  defaultKeyFile: string,
): OperatorKeyPair {
  if (options.keyFile && options.keyPair) {
    throw new Error('Pass keyFile or keyPair, not both')
  }
  if (options.keyPair) return toOperatorKeypair(options.keyPair)
  return loadOrCreateOperatorKeypair(options.keyFile ?? defaultKeyFile)
}

export function createEphemeralClientKeypair(): OperatorKeyPair {
  const kp = HyperDHT.keyPair()
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    z32: encodePublicKeyZ32(kp.publicKey),
  }
}
