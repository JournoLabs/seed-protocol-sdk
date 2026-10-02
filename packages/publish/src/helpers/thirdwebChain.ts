import { defineChain, optimismSepolia, type Chain as ThirdwebChain } from 'thirdweb/chains'
import type { Chain as ViemChain } from 'viem'
import { getPublishViemChain } from './chainConfig'

let cached: { id: number; chain: ThirdwebChain } | null = null

/**
 * Thirdweb chain matching the configured publish chain (`PublishConfig.chain`).
 * All Thirdweb wallet connect / deploy / contract calls must use this instead of a fixed chain.
 * Pass `viemChain` when the config ref may not be set yet (e.g. first React render).
 */
export function getPublishThirdwebChain(viemChain: ViemChain = getPublishViemChain()): ThirdwebChain {
  if (cached?.id === viemChain.id) return cached.chain
  // No `rpc`: Thirdweb fills in its RPC edge (as its built-in chain exports do) so sponsored /
  // in-app wallet calls are authenticated by the client. viem reads still use PublishConfig.rpcUrl.
  const chain =
    viemChain.id === optimismSepolia.id
      ? optimismSepolia
      : defineChain({
          id: viemChain.id,
          name: viemChain.name,
          nativeCurrency: viemChain.nativeCurrency,
          testnet: viemChain.testnet ? true : undefined,
          blockExplorers: viemChain.blockExplorers
            ? Object.values(viemChain.blockExplorers).map(({ name, url, apiUrl }) => ({ name, url, apiUrl }))
            : undefined,
        })
  cached = { id: viemChain.id, chain }
  return chain
}
