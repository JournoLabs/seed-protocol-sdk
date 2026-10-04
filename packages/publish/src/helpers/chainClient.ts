import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from 'viem'
import { getPublishConfig } from '../config'
import { PublishTransactionRevertedError } from '../errors'
import { getPublishRpcUrl, getPublishViemChain } from './chainConfig'

type PublishPublicClient = PublicClient

let _client: PublishPublicClient | null = null
let _clientKey: string | null = null

function publishRpcFetchOptions(): { headers: { 'x-secret-key': string } } | undefined {
  try {
    const secret = getPublishConfig().thirdwebSecretKey
    if (!secret) return undefined
    return { headers: { 'x-secret-key': secret } }
  } catch {
    return undefined
  }
}

function createPublishPublicClient(): PublishPublicClient {
  const chain = getPublishViemChain()
  const rpcUrl = getPublishRpcUrl()
  const fetchOptions = publishRpcFetchOptions()
  return createPublicClient({
    chain,
    transport: http(rpcUrl, fetchOptions ? { fetchOptions } : undefined),
  })
}

/**
 * Viem public client for reads / receipts on the configured publish chain.
 */
export function getPublishPublicClient(): PublishPublicClient {
  const chain = getPublishViemChain()
  const rpcUrl = getPublishRpcUrl()
  let secret = ''
  try {
    secret = getPublishConfig().thirdwebSecretKey ?? ''
  } catch {
    secret = ''
  }
  const key = `${chain.id}:${rpcUrl}:${secret ? '1' : '0'}:${secret}`
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

/**
 * Waits for `transactionHash` to be mined and returns its receipt.
 *
 * @throws PublishTransactionRevertedError when the transaction reverted. A successful receipt
 * only covers the outer transaction: for a sponsored (relayed) send, check the receipt's logs to
 * confirm the inner call did what it should.
 */
export async function waitForPublishReceipt(transactionHash: Hex): Promise<TransactionReceipt> {
  const receipt = await getPublishPublicClient().waitForTransactionReceipt({ hash: transactionHash })
  if (receipt.status === 'reverted') throw new PublishTransactionRevertedError(transactionHash, receipt)
  return receipt
}

/**
 * Calls `read` until `accept` passes on its result, up to `attempts` times, and returns the last
 * result either way. For reads right after a receipt: a load-balanced RPC can serve them from a
 * node that has not seen the receipt's block yet, and pinning `blockNumber` does not help there.
 */
export async function readUntil<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  { attempts = 5, intervalMs = 2_000 }: { attempts?: number; intervalMs?: number } = {},
): Promise<T> {
  let value = await read()
  for (let i = 1; i < attempts && !accept(value); i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    value = await read()
  }
  return value
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
