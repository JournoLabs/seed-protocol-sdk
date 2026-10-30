import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import HyperDHT, { type HyperDHTStream } from 'hyperdht'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli'
import { loadOrCreateOperatorKeypair, resolveClientKeypair } from '../src/keys'
import { createTunnelSession } from '../src/tunnel/session'
import { startTestnet, type LocalTestnet } from './helpers/testnet'

function tmpKeyFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-hyper-client-')), 'client.key.json')
}

describe('resolveClientKeypair', () => {
  it('returns a new key each time without keyFile or keyPair', () => {
    expect(resolveClientKeypair({}).z32).not.toBe(resolveClientKeypair({}).z32)
  })

  it('returns the key in keyFile, creating it on first use', () => {
    const keyFile = tmpKeyFile()
    const first = resolveClientKeypair({ keyFile })
    expect(fs.existsSync(keyFile)).toBe(true)
    expect(resolveClientKeypair({ keyFile }).z32).toBe(first.z32)
  })

  it('accepts a keyPair and rejects one whose halves do not match', () => {
    const kp = HyperDHT.keyPair()
    expect(resolveClientKeypair({ keyPair: kp }).publicKey.equals(kp.publicKey)).toBe(true)
    const other = HyperDHT.keyPair()
    expect(() =>
      resolveClientKeypair({ keyPair: { publicKey: other.publicKey, secretKey: kp.secretKey } }),
    ).toThrow(/does not belong/)
    expect(() =>
      resolveClientKeypair({ keyPair: { publicKey: kp.publicKey.subarray(1), secretKey: kp.secretKey } }),
    ).toThrow(/32-byte/)
  })

  it('refuses keyFile and keyPair together', () => {
    expect(() => resolveClientKeypair({ keyFile: tmpKeyFile(), keyPair: HyperDHT.keyPair() })).toThrow(
      /not both/,
    )
  })
})

describe('client key over HyperDHT', () => {
  let testnet: LocalTestnet
  let dht: HyperDHT
  const seen: Buffer[] = []
  let operatorKey: string

  beforeAll(async () => {
    testnet = await startTestnet()
    dht = new HyperDHT({ bootstrap: testnet.bootstrap })
    const server = dht.createServer((stream: HyperDHTStream) => {
      seen.push(Buffer.from(stream.remotePublicKey))
      stream.on('error', () => {})
      stream.destroy()
    })
    const kp = HyperDHT.keyPair()
    await server.listen(kp)
    operatorKey = kp.publicKey.toString('hex')
  })

  afterAll(async () => {
    await dht.destroy()
    await testnet.destroy()
  })

  async function connectOnce(keyFile: string): Promise<string> {
    const session = await createTunnelSession({
      key: operatorKey,
      keyFile,
      bootstrap: testnet.bootstrap,
    })
    try {
      await session.runOnTunnel(async () => undefined)
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))
      const remote = seen.splice(0)[0]!
      expect(remote.equals(loadOrCreateOperatorKeypair(keyFile).publicKey)).toBe(true)
      return session.clientKey
    } finally {
      await session.close()
    }
  }

  it('presents the same key on every run with the same keyFile', async () => {
    const keyFile = tmpKeyFile()
    const first = await connectOnce(keyFile)
    const second = await connectOnce(keyFile)
    expect(second).toBe(first)
    expect(first).toBe(loadOrCreateOperatorKeypair(keyFile).z32)
  }, 30_000)
})

describe('seed-gateway connect --print-key', () => {
  it('prints the key in the key file', async () => {
    const keyFile = tmpKeyFile()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await main(['connect', '--print-key', '--key-file', keyFile])
      await main(['connect', '--print-key', '--key-file', keyFile])
      const z32 = loadOrCreateOperatorKeypair(keyFile).z32
      expect(log.mock.calls).toEqual([[z32], [z32]])
    } finally {
      log.mockRestore()
    }
  })
})
