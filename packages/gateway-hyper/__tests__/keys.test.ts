import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decodePublicKey, encodePublicKeyZ32, loadOrCreateOperatorKeypair } from '../src/keys'

describe('gateway-hyper keys', () => {
  it('creates and reloads operator keypair file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-hyper-keys-'))
    const keyFile = path.join(dir, 'operator.key.json')
    const first = loadOrCreateOperatorKeypair(keyFile)
    expect(first.z32.length).toBeGreaterThan(10)
    expect(fs.existsSync(keyFile)).toBe(true)

    const second = loadOrCreateOperatorKeypair(keyFile)
    expect(second.z32).toBe(first.z32)
    expect(second.publicKey.equals(first.publicKey)).toBe(true)
  })

  it('decodes z32 and hex public keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-hyper-decode-'))
    const kp = loadOrCreateOperatorKeypair(path.join(dir, 'k.json'))
    const fromZ32 = decodePublicKey(kp.z32)
    const fromHex = decodePublicKey(kp.publicKey.toString('hex'))
    expect(fromZ32.equals(fromHex)).toBe(true)
    expect(encodePublicKeyZ32(fromZ32)).toBe(kp.z32)
  })
})
