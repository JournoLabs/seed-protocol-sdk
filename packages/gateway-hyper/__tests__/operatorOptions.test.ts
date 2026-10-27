import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import HyperDHT from 'hyperdht'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_UPSTREAM_TIMEOUT_MS,
  encodePublicKeyZ32,
  serveRawTunnel,
  serveTunnel,
} from '../src/index'
import { startTestnet } from './helpers/testnet'

const tmpKeyFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-op-')), 'operator.key.json')

describe('serveTunnel options', () => {
  it('refuses an https:// upstream: the framed tunnel speaks plain HTTP to it', async () => {
    await expect(serveTunnel({ upstream: 'https://upload.example.com', keyFile: tmpKeyFile() })).rejects.toThrow(
      /plain HTTP.*serveRawTunnel/,
    )
  })

  it('takes the operator keypair itself, and refuses keyFile and keyPair together', async () => {
    const testnet = await startTestnet()
    const keyPair = HyperDHT.keyPair()
    try {
      const operator = await serveTunnel({ upstream: 'http://127.0.0.1:9', keyPair, bootstrap: testnet.bootstrap })
      expect(operator.key).toBe(encodePublicKeyZ32(keyPair.publicKey))
      await operator.close()
      await expect(serveTunnel({ upstream: 'http://127.0.0.1:9', keyPair, keyFile: tmpKeyFile() })).rejects.toThrow(
        /keyFile or keyPair, not both/,
      )
      await expect(
        serveRawTunnel({ upstream: '127.0.0.1:9', keyPair, keyFile: tmpKeyFile(), bootstrap: testnet.bootstrap }),
      ).rejects.toThrow(/keyFile or keyPair, not both/)
    } finally {
      await testnet.destroy()
    }
  }, 30_000)
})

describe('timeout defaults', () => {
  it("outlast publish's 120 s batch upload, the client's above the operator's", () => {
    expect(DEFAULT_UPSTREAM_TIMEOUT_MS).toBeGreaterThan(120_000)
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBeGreaterThan(DEFAULT_UPSTREAM_TIMEOUT_MS)
  })
})
