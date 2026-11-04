/**
 * ENS reads against Ethereum mainnet through viem's default RPC for the chain, or `ENS_RPC_URL`.
 * Skipped unless SEED_LIVE_NETWORK_TESTS=1.
 *
 *   cd packages/query && SEED_LIVE_NETWORK_TESTS=1 bunx vitest run __tests__/ens.live.test.ts
 */
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { getEnsContenthash, getEnsNames, getSeedPublication } from '../src/ens/index.js'

const runLive = process.env.SEED_LIVE_NETWORK_TESTS === '1'
const VITALIK = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'

describe.skipIf(!runLive)('ENS reads on mainnet', () => {
  const client = createPublicClient({ chain: mainnet, transport: http(process.env.ENS_RPC_URL) })

  it('decodes the contenthash of vitalik.eth', async () => {
    const contenthash = await getEnsContenthash(client, { name: 'vitalik.eth' })
    expect(contenthash?.protocol).toBe('ipfs')
    expect(contenthash?.uri).toMatch(/^ipfs:\/\/b/)
  }, 30_000)

  it('returns null for a name with no Seed publication record', async () => {
    expect(await getSeedPublication(client, { name: 'vitalik.eth' })).toBeNull()
  }, 30_000)

  it('reverse-resolves an address to its primary name', async () => {
    const names = await getEnsNames(client, [VITALIK])
    expect(names.get(VITALIK)).toBe('vitalik.eth')
  }, 30_000)
})
