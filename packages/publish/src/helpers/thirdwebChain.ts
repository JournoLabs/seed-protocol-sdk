import { defineChain, optimismSepolia, type Chain as ThirdwebChain } from 'thirdweb/chains'
import type { Chain as ViemChain } from 'viem'
import { getConfigRef } from '../config'
import { DEFAULT_PUBLISH_CHAIN } from './defaultChain'

let cached: { key: string; chain: ThirdwebChain } | null = null

/**
 * Thirdweb chain matching the publish chain (`PublishConfig.chain`) and RPC (`PublishConfig.rpcUrl`).
 * All Thirdweb wallet connect / deploy / contract calls must use this instead of a fixed chain.
 *
 * With `rpcUrl` set, Thirdweb uses it too, so Seed's own reads and Thirdweb's calls always reach
 * the same node (e.g. a local fork). Without it, Thirdweb uses its RPC edge, as viem does.
 *
 * Pass `source` when the config ref may not be set yet (e.g. first React render).
 */
export function getPublishThirdwebChain(source?: { chain?: ViemChain; rpcUrl?: string }): ThirdwebChain {
  const ref = source ?? getConfigRef() ?? {}
  const viemChain = ref.chain ?? DEFAULT_PUBLISH_CHAIN
  const rpcUrl = ref.rpcUrl?.trim() || undefined
  const key = `${viemChain.id}|${rpcUrl ?? ''}`
  if (cached?.key === key) return cached.chain

  let chain: ThirdwebChain
  if (viemChain.id === optimismSepolia.id && !rpcUrl) {
    chain = optimismSepolia
  } else {
    // Without `rpc`, defineChain fills in Thirdweb's RPC edge for the chain id.
    chain = defineChain({
      id: viemChain.id,
      name: viemChain.name,
      nativeCurrency: viemChain.nativeCurrency,
      testnet: viemChain.testnet ? true : undefined,
      blockExplorers: viemChain.blockExplorers
        ? Object.values(viemChain.blockExplorers).map(({ name, url, apiUrl }) => ({ name, url, apiUrl }))
        : undefined,
      ...(rpcUrl ? { rpc: rpcUrl } : {}),
    })
  }
  cached = { key, chain }
  return chain
}
