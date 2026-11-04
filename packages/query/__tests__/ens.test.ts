import { CID } from 'multiformats/cid'
import { base36 } from 'multiformats/bases/base36'
import {
  createClient,
  custom,
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  RpcRequestError,
  type Hex,
} from 'viem'
import { mainnet } from 'viem/chains'
import { namehash } from 'viem/ens'
import { describe, expect, it } from 'vitest'
import {
  decodeContenthash,
  getEnsContenthash,
  getEnsNames,
  getSeedPublication,
  parseSeedPublicationRecord,
  SEED_PUBLICATION_TEXT_KEY,
} from '../src/ens/index.js'

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

describe('decodeContenthash', () => {
  it('decodes an IPFS CIDv0 contenthash to CIDv1 base32', () => {
    // EIP-1577's example: QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4
    const result = decodeContenthash(
      '0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f',
    )
    expect(result).toEqual({
      protocol: 'ipfs',
      value: 'bafybeibj6lixxzqtsb45ysdjnupvqkufgdvzqbnvmhw2kf7cfkesy7r7d4',
      uri: 'ipfs://bafybeibj6lixxzqtsb45ysdjnupvqkufgdvzqbnvmhw2kf7cfkesy7r7d4',
    })
    expect(CID.parse(result!.value).toV0().toString()).toBe('QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4')
  })

  it('decodes an IPNS key to base36', () => {
    const key = 'k51qzi5uqu5dlvj2baxnqndepeb86cbk3ng7n3i46uzyxzyqj2xjonzllnv0v8'
    const cid = CID.parse(key, base36)
    const result = decodeContenthash(`0xe501${bytesToHex(cid.bytes)}`)
    expect(result).toEqual({ protocol: 'ipns', value: key, uri: `ipns://${key}` })
  })

  it('decodes a legacy IPNS DNSLink record to its domain', () => {
    const domain = new TextEncoder().encode('blog.example.com')
    // CIDv1, raw (0x55), identity multihash (0x00) holding the domain.
    const hex = `0xe5010155 00${domain.length.toString(16).padStart(2, '0')}${bytesToHex(domain)}`.replace(' ', '')
    expect(decodeContenthash(hex)).toEqual({
      protocol: 'ipns',
      value: 'blog.example.com',
      uri: 'ipns://blog.example.com',
    })
  })

  it('decodes a Swarm manifest hash', () => {
    const hash = 'd1de9994b4d039f6548d191eb26786769f580809256b4685ef316805265ea162'
    expect(decodeContenthash(`0xe40101fa011b20${hash}`)).toEqual({
      protocol: 'swarm',
      value: hash,
      uri: `bzz://${hash}`,
    })
  })

  it('decodes an Arweave id (arweave-ns, 0xb29910)', () => {
    const id = 'ys32Pt8uC7TrVxHdOLByOspfPEq2LO63wREHQIM9SJQ'
    const payload = bytesToHex(new Uint8Array(Buffer.from(id, 'base64url')))
    expect(decodeContenthash(`0x90b2ca05${payload}`)).toEqual({ protocol: 'arweave', value: id, uri: `ar://${id}` })
  })

  it('takes bytes as well as hex', () => {
    const bytes = new Uint8Array(Buffer.from('e40101fa011b20' + '11'.repeat(32), 'hex'))
    expect(decodeContenthash(bytes)?.value).toBe('11'.repeat(32))
  })

  it('returns null for an empty contenthash', () => {
    expect(decodeContenthash('0x')).toBeNull()
    expect(decodeContenthash(new Uint8Array())).toBeNull()
  })

  it('throws on an unknown codec, a bare codec, a bad CID and non-hex', () => {
    expect(() => decodeContenthash('0xef01abcd')).toThrow(/codec 0xef/)
    expect(() => decodeContenthash('0xe301')).toThrow(/no content id/)
    expect(() => decodeContenthash('0xe301ffff')).toThrow(/not a CID/)
    expect(() => decodeContenthash('0xe3z1')).toThrow(/not hex/)
  })
})

describe('parseSeedPublicationRecord', () => {
  const publisher = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'

  it('reads every field and lower-cases the publisher', () => {
    const record = parseSeedPublicationRecord(
      JSON.stringify({ schema: ' Blog ', publisher, feed: 'https://alice.example/feed.xml', chainId: 10, extra: 1 }),
    )
    expect(record).toEqual({
      schemaName: 'Blog',
      publisher: publisher.toLowerCase(),
      feedUrl: 'https://alice.example/feed.xml',
      chainId: 10,
    })
  })

  it('needs only schema', () => {
    expect(parseSeedPublicationRecord('{"schema":"Blog"}')).toEqual({ schemaName: 'Blog' })
  })

  it.each([
    ['not json', /not JSON/],
    ['[]', /not a JSON object/],
    ['{}', /"schema"/],
    ['{"schema":"  "}', /"schema"/],
    ['{"schema":"Blog","publisher":"alice.eth"}', /"publisher"/],
    ['{"schema":"Blog","feed":"/feed.xml"}', /"feed"/],
    ['{"schema":"Blog","chainId":"10"}', /"chainId"/],
    ['{"schema":"Blog","chainId":0}', /"chainId"/],
  ])('rejects %s', (text, message) => {
    expect(() => parseSeedPublicationRecord(text)).toThrow(message)
  })
})

// --- A Universal Resolver behind an EIP-1193 transport: the network boundary. ---

const universalResolverAbi = [
  { type: 'error', name: 'ResolverNotFound', inputs: [{ name: 'name', type: 'bytes' }] },
  {
    type: 'function',
    name: 'resolveWithGateways',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'data', type: 'bytes' },
      { name: 'gateways', type: 'string[]' },
    ],
    outputs: [
      { name: '', type: 'bytes' },
      { name: 'address', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'reverseWithGateways',
    stateMutability: 'view',
    inputs: [
      { name: 'reverseName', type: 'bytes' },
      { name: 'coinType', type: 'uint256' },
      { name: 'gateways', type: 'string[]' },
    ],
    outputs: [
      { name: 'resolvedName', type: 'string' },
      { name: 'resolver', type: 'address' },
      { name: 'reverseResolver', type: 'address' },
    ],
  },
] as const

const resolverAbi = [
  {
    type: 'function',
    name: 'text',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'contenthash',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    type: 'function',
    name: 'addr',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

type NameRecords = { text?: Record<string, string>; contenthash?: Hex; addr?: Hex }
const RESOLVER = '0x1111111111111111111111111111111111111111'
const UNIVERSAL_RESOLVER = '0xeeeeeeee14d718c2b47d9923deab1335e144eeee'

// What viem's http transport throws for a JSON-RPC error response.
const revert = (data: Hex) =>
  new RpcRequestError({ body: {}, url: 'http://rpc.test', error: { code: 3, message: 'execution reverted', data } })

function ensClient(names: Record<string, NameRecords>, primaryNames: Record<string, string> = {}) {
  const byNode = new Map(Object.entries(names).map(([name, records]) => [namehash(name), records]))
  const calls: string[] = []
  const transport = custom({
    async request({ method, params }) {
      if (method === 'eth_chainId') return '0x1'
      if (method !== 'eth_call') throw new Error(`unexpected ${method}`)
      const [{ to, data }] = params as [{ to: string; data: Hex }]
      expect(to.toLowerCase()).toBe(UNIVERSAL_RESOLVER)
      const outer = decodeFunctionData({ abi: universalResolverAbi, data })

      if (outer.functionName === 'reverseWithGateways') {
        const address = outer.args[0].toLowerCase()
        calls.push(`reverse:${address}`)
        const name = primaryNames[address]
        if (!name) throw revert(encodeErrorResult({ abi: universalResolverAbi, errorName: 'ResolverNotFound', args: ['0x'] }))
        return encodeFunctionResult({
          abi: universalResolverAbi,
          functionName: 'reverseWithGateways',
          result: [name, RESOLVER, RESOLVER],
        })
      }

      const inner = decodeFunctionData({ abi: resolverAbi, data: outer.args[1] })
      const records = byNode.get(inner.args[0])
      calls.push(`${inner.functionName}:${inner.args[0]}`)
      if (!records) {
        throw revert(encodeErrorResult({ abi: universalResolverAbi, errorName: 'ResolverNotFound', args: [outer.args[0]] }))
      }
      const result =
        inner.functionName === 'text'
          ? encodeFunctionResult({ abi: resolverAbi, functionName: 'text', result: records.text?.[inner.args[1]] ?? '' })
          : inner.functionName === 'contenthash'
            ? encodeFunctionResult({ abi: resolverAbi, functionName: 'contenthash', result: records.contenthash ?? '0x' })
            : encodeFunctionResult({
                abi: resolverAbi,
                functionName: 'addr',
                result: records.addr ?? '0x0000000000000000000000000000000000000000',
              })
      return encodeFunctionResult({ abi: universalResolverAbi, functionName: 'resolveWithGateways', result: [result, RESOLVER] })
    },
  })
  return { client: createClient({ chain: mainnet, transport }), calls }
}

const IPFS_HASH = '0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f' as const
const PUBLISHER = '0x2222222222222222222222222222222222222222'
const NAME_ADDRESS = '0x3333333333333333333333333333333333333333'

describe('getEnsContenthash', () => {
  it('decodes the resolver contenthash', async () => {
    const { client } = ensClient({ 'alice.eth': { contenthash: IPFS_HASH } })
    expect(await getEnsContenthash(client, { name: 'alice.eth' })).toMatchObject({
      protocol: 'ipfs',
      uri: 'ipfs://bafybeibj6lixxzqtsb45ysdjnupvqkufgdvzqbnvmhw2kf7cfkesy7r7d4',
    })
  })

  it('normalizes the name before resolving', async () => {
    const { client } = ensClient({ 'alice.eth': { contenthash: IPFS_HASH } })
    expect(await getEnsContenthash(client, { name: 'Alice.ETH' })).not.toBeNull()
  })

  it('returns null with no contenthash or no resolver', async () => {
    const { client } = ensClient({ 'alice.eth': {} })
    expect(await getEnsContenthash(client, { name: 'alice.eth' })).toBeNull()
    expect(await getEnsContenthash(client, { name: 'nobody.eth' })).toBeNull()
  })
})

describe('getSeedPublication', () => {
  it('reads the text record and contenthash', async () => {
    const { client } = ensClient({
      'alice.eth': {
        contenthash: IPFS_HASH,
        text: {
          [SEED_PUBLICATION_TEXT_KEY]: JSON.stringify({
            schema: 'Blog',
            publisher: PUBLISHER,
            feed: 'https://alice.example/feed.xml',
            chainId: 11155420,
          }),
        },
      },
    })
    expect(await getSeedPublication(client, { name: 'alice.eth' })).toEqual({
      name: 'alice.eth',
      schemaName: 'Blog',
      publisher: PUBLISHER,
      feedUrl: 'https://alice.example/feed.xml',
      chainId: 11155420,
      contenthash: expect.objectContaining({ protocol: 'ipfs' }),
    })
  })

  it("falls back to the name's ETH address for the publisher", async () => {
    const { client } = ensClient({
      'alice.eth': { addr: NAME_ADDRESS, text: { [SEED_PUBLICATION_TEXT_KEY]: '{"schema":"Blog"}' } },
    })
    expect(await getSeedPublication(client, { name: 'alice.eth' })).toEqual({
      name: 'alice.eth',
      schemaName: 'Blog',
      publisher: NAME_ADDRESS,
      contenthash: null,
    })
  })

  it('resolves a subname through the same path', async () => {
    const { client } = ensClient({
      'blog.alice.eth': { text: { [SEED_PUBLICATION_TEXT_KEY]: `{"schema":"Blog","publisher":"${PUBLISHER}"}` } },
    })
    expect((await getSeedPublication(client, { name: 'blog.alice.eth' }))?.publisher).toBe(PUBLISHER)
  })

  it('returns null with no record and throws on a bad record or no publisher', async () => {
    const { client } = ensClient({
      'plain.eth': { contenthash: IPFS_HASH },
      'bad.eth': { text: { [SEED_PUBLICATION_TEXT_KEY]: '{"schema":1}' } },
      'nobody.eth': { text: { [SEED_PUBLICATION_TEXT_KEY]: '{"schema":"Blog"}' } },
    })
    expect(await getSeedPublication(client, { name: 'plain.eth' })).toBeNull()
    expect(await getSeedPublication(client, { name: 'missing.eth' })).toBeNull()
    await expect(getSeedPublication(client, { name: 'bad.eth' })).rejects.toThrow(/"schema"/)
    await expect(getSeedPublication(client, { name: 'nobody.eth' })).rejects.toThrow(/no publisher/)
  })
})

describe('getEnsNames', () => {
  it('looks each address up once and maps misses to null', async () => {
    const { client, calls } = ensClient({}, { [PUBLISHER]: 'alice.eth' })
    const names = await getEnsNames(client, [PUBLISHER, PUBLISHER.toUpperCase().replace('0X', '0x'), NAME_ADDRESS, 'alice'])
    expect(names).toEqual(
      new Map([
        [PUBLISHER, 'alice.eth'],
        [NAME_ADDRESS, null],
      ]),
    )
    expect(calls.filter((c) => c.startsWith('reverse:'))).toHaveLength(2)
  })
})
