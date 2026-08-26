import type { Chain } from 'viem'
import { getPublishConfig } from '../config'
import { DEFAULT_PUBLISH_CHAIN } from './defaultChain'

export { DEFAULT_PUBLISH_CHAIN }

/**
 * Resolved viem chain for public client + adapters.
 */
export function getPublishViemChain(): Chain {
  try {
    return getPublishConfig().chain ?? DEFAULT_PUBLISH_CHAIN
  } catch {
    return DEFAULT_PUBLISH_CHAIN
  }
}

/**
 * Resolved RPC URL. Prefer explicit `rpcUrl`; fall back to Thirdweb edge URL when client id is set.
 */
export function getPublishRpcUrl(): string {
  const config = getPublishConfig()
  if (config.rpcUrl) return config.rpcUrl
  if (config.thirdwebClientId) {
    const chainId = (config.chain ?? DEFAULT_PUBLISH_CHAIN).id
    return `https://${chainId}.rpc.thirdweb.com/${config.thirdwebClientId}`
  }
  throw new Error(
    '@seedprotocol/publish: rpcUrl is required when thirdwebClientId is not set. Pass rpcUrl in initPublish / PublishProvider config.',
  )
}
