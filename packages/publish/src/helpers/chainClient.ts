import { createPublicClient, http, type Address, type Hex, type PublicClient } from 'viem'
import { getPublishRpcUrl, getPublishViemChain } from './chainConfig'

type PublishPublicClient = PublicClient

let _client: PublishPublicClient | null = null
let _clientKey: string | null = null

function createPublishPublicClient(): PublishPublicClient {
  const chain = getPublishViemChain()
  const rpcUrl = getPublishRpcUrl()
  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
}

/**
 * Viem public client for reads / receipts on the configured publish chain.
 */
export function getPublishPublicClient(): PublishPublicClient {
  const chain = getPublishViemChain()
  const rpcUrl = getPublishRpcUrl()
  const key = `${chain.id}:${rpcUrl}`
  if (!_client || _clientKey !== key) {
    _clientKey = key
    _client = createPublishPublicClient()
  }
  return _client
}

/** Reset cached client (tests). */
export function resetPublishPublicClient(): void {
  _client = null
  _clientKey = null
}

export async function waitForPublishReceipt(transactionHash: Hex) {
  return getPublishPublicClient().waitForTransactionReceipt({ hash: transactionHash })
}

export async function isContractDeployed(address: string): Promise<boolean> {
  const code = await getPublishPublicClient().getBytecode({
    address: address as Address,
  })
  return !!code && code !== '0x'
}

export async function getBlockTimestampMs(blockNumber: bigint): Promise<number | null> {
  try {
    const block = await getPublishPublicClient().getBlock({ blockNumber })
    if (block?.timestamp != null) return Number(block.timestamp) * 1000
  } catch {
    // ignore
  }
  return null
}

const DEFAULT_DEPLOY_POLL_ATTEMPTS = 5
const DEFAULT_DEPLOY_POLL_INTERVAL_MS = 6_000

/** Polls chain bytecode until the smart account is deployed or attempts are exhausted. */
export async function pollSmartWalletDeployed(
  smartWalletAddress: string,
  attempts: number = DEFAULT_DEPLOY_POLL_ATTEMPTS,
  intervalMs: number = DEFAULT_DEPLOY_POLL_INTERVAL_MS,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await isContractDeployed(smartWalletAddress)) {
      return true
    }
    if (i < attempts - 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, intervalMs)
      })
    }
  }
  return false
}
