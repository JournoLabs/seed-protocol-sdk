import { describe, expect, it } from 'vitest'
import { computeCid, ipfsGatewayUrls, parseIpfsId, toCar, unixFsDag } from '../src'
import { sha256, toHex } from '../src/cid'
import { lcgBytes } from './fixtures'

// From Kubo 0.21: `ipfs add --only-hash --cid-version=1 -Q <file>` (raw leaves, 256 KiB chunks,
// balanced, 174 links), and `ipfs dag export <cid> | shasum -a 256` for the CAR.
const VECTORS = [
  { name: 'empty', bytes: () => new Uint8Array(), cid: 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku' },
  {
    name: '"hello world"',
    bytes: () => new TextEncoder().encode('hello world'),
    cid: 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e',
    car: '7749e28c4fe3f68c00ac08af41c1c4f6e0275c86bd9e8ae7b9446da7d1663710',
  },
  { name: 'one full chunk', bytes: () => lcgBytes(262_144, 1), cid: 'bafkreifystqgug5z6myhn45jr6skxoe3mtdoshssgfvv6otctnc7wuaaia' },
  {
    name: 'one chunk and a byte',
    bytes: () => lcgBytes(262_145, 2),
    cid: 'bafybeicvgckzz6ase53abylgj65apb5iaw6uz443ajjtxa7oqxlmijosje',
    car: '0c445850e1a863c672d6b6579e01a3bf35f729bf24610d36c757145972eff440',
  },
  {
    name: '1 MiB + 1000',
    bytes: () => lcgBytes(1_049_576, 3),
    cid: 'bafybeihbyoikmnmkm22rty2ufhi3mb4qzuicmlniwtbjppyq6ottipbtla',
    car: 'ca0b525bb5ab2469f52a26ae7d9c5b318319f57ba3eb4f62ccebde1872f5a66d',
  },
  {
    // 175 leaves: two levels, and repeated leaves the CAR writes once.
    name: '174 chunks + 5',
    bytes: () => lcgBytes(174 * 262_144 + 5, 4),
    cid: 'bafybeifmgpvlfvtlqmf23g5h3ezf6b6hhb6ljpmbzgv754fvy5ujwhl7py',
    car: '38b0cedac8cd63d8f6a043dc1b4ab5b989af225bd3587b4c37a22daa8e725389',
  },
]

describe('computeCid', () => {
  for (const v of VECTORS) {
    it(`matches Kubo for ${v.name}`, async () => {
      const dag = await unixFsDag(v.bytes())
      expect(dag.root).toBe(v.cid)
      if (v.car) expect(toHex(await sha256(toCar(dag)))).toBe(v.car)
    })
  }

  it('gives a blob of one block the CID of its SHA-256', async () => {
    const bytes = new TextEncoder().encode('hello world')
    const parsed = parseIpfsId(`ipfs://${await computeCid(bytes)}`)
    expect(parsed).toEqual({ cid: VECTORS[1]!.cid, codec: 'raw', sha256: toHex(await sha256(bytes)) })
  })
})

describe('parseIpfsId', () => {
  it('has no SHA-256 for a dag-pb root', () => {
    expect(parseIpfsId(`ipfs://${VECTORS[3]!.cid}`)).toEqual({ cid: VECTORS[3]!.cid, codec: 'dag-pb' })
  })

  it('refuses ids that are not ipfs:// CIDv1s', () => {
    expect(parseIpfsId('Xm1a0WZ1W7f0ZbGQm2Z0RZ8M6vYb2f0aZf7Bf3Qm9xk')).toBeUndefined()
    expect(parseIpfsId('ipfs://QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o')).toBeUndefined()
    expect(parseIpfsId('ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyk')).toBeUndefined()
  })
})

describe('ipfsGatewayUrls', () => {
  it('names the CID on each gateway, in order', () => {
    const cid = VECTORS[1]!.cid
    expect(ipfsGatewayUrls(`ipfs://${cid}`, ['https://gw.example/', 'http://127.0.0.1:8080'])).toEqual([
      `https://gw.example/ipfs/${cid}`,
      `http://127.0.0.1:8080/ipfs/${cid}`,
    ])
    expect(ipfsGatewayUrls(`ipfs://${cid}`)).toEqual([`https://ipfs.io/ipfs/${cid}`, `https://dweb.link/ipfs/${cid}`])
  })

  it('is empty for an Arweave id', () => {
    expect(ipfsGatewayUrls('Xm1a0WZ1W7f0ZbGQm2Z0RZ8M6vYb2f0aZf7Bf3Qm9xk')).toEqual([])
  })
})
