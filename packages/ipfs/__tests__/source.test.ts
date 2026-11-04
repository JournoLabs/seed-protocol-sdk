import { describe, expect, it } from 'vitest'
import type { BlobSource } from '@seedprotocol/sdk'
import { ipfsBlobSource } from '../src'
import { sha256, toHex } from '../src/cid'
import { lcgBytes } from './fixtures'

// CIDs from Kubo 0.21 (see cid.test.ts).
const EMPTY = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const HELLO = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
const FULL_CHUNK = 'bafkreifystqgug5z6myhn45jr6skxoe3mtdoshssgfvv6otctnc7wuaaia'
const DAG_PB = 'bafybeicvgckzz6ase53abylgj65apb5iaw6uz443ajjtxa7oqxlmijosje'
const ARWEAVE_ID = 'Xm1a0WZ1W7f0ZbGQm2Z0RZ8M6vYb2f0aZf7Bf3Qm9xk'

const source = ipfsBlobSource({ gateways: ['https://gw.example/', 'http://127.0.0.1:8080'] }) satisfies BlobSource

describe('ipfsBlobSource', () => {
  it('keys an ipfs:// id and its bare CID alike', () => {
    for (const cid of [HELLO, DAG_PB]) {
      expect(source.key(`ipfs://${cid}`)).toBe(cid)
      expect(source.key(source.key(`ipfs://${cid}`)!)).toBe(cid)
    }
  })

  it('leaves Arweave ids and anything that is not a CIDv1 unclaimed', () => {
    for (const id of [
      ARWEAVE_ID,
      'ipfs://QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o',
      `ipfs://${HELLO}/index.html`,
      `ipfs://${HELLO}.png`,
      `ipfs://../${HELLO}`,
      `ar://${HELLO}`,
      'ipfs://',
    ]) {
      expect(source.key(id)).toBeUndefined()
    }
  })

  it('reads a key from each gateway in order', () => {
    expect(source.urls(HELLO)).toEqual([`https://gw.example/ipfs/${HELLO}`, `http://127.0.0.1:8080/ipfs/${HELLO}`])
    expect(ipfsBlobSource().urls(HELLO)).toEqual([`https://ipfs.io/ipfs/${HELLO}`, `https://dweb.link/ipfs/${HELLO}`])
    expect(source.urls(ARWEAVE_ID)).toEqual([])
  })

  it("gives a raw CID's bytes' SHA-256, and none for a dag-pb root", async () => {
    expect(source.sha256(EMPTY)).toBe(toHex(await sha256(new Uint8Array())))
    expect(source.sha256(HELLO)).toBe(toHex(await sha256(new TextEncoder().encode('hello world'))))
    expect(source.sha256(FULL_CHUNK)).toBe(toHex(await sha256(lcgBytes(262_144, 1))))
    expect(source.sha256(DAG_PB)).toBeUndefined()
  })
})
