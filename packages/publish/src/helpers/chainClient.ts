import { createPublicClient, http, type Address, type Hex } from 'viem'
import { optimismSepolia } from 'viem/chains'
import { getPublishConfig } from '../config'

type PublishPublicClient = ReturnType<typeof createPublishPublicClient>

function createPublishPublicClient(thirdwebClientId: string) {
  return createPublicClient({
    chain: optimismSepolia,
    transport: http(`https://11155420.rpc.thirdweb.com/${thirdwebClientId}`),
  })
}

let _client: PublishPublicClient | null = null
let _clientId: string | null = null

/**
 * Viem public client for Optimism Sepolia reads / receipts.
 * Uses the same Thirdweb RPC edge URL as the wallet client (no new env var).
 */
export function getPublishPublicClient(): PublishPublicClient {
  const { thirdwebClientId } = getPublishConfig()
  if (!_client || _clientId !== thirdwebClientId) {
    _clientId = thirdwebClientId
    _client = createPublishPublicClient(thirdwebClientId)
  }
  return _client
}

/** Reset cached client (tests). */
export function resetPublishPublicClient(): void {
  _client = null
  _clientId = null
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
