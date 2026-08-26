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

export function createEphemeralClientKeypair(): OperatorKeyPair {
  const kp = HyperDHT.keyPair()
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    z32: encodePublicKeyZ32(kp.publicKey),
  }
}
