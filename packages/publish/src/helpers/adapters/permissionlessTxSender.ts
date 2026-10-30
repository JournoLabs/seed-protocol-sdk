import type { Address, LocalAccount, SignableMessage } from 'viem'
import { createPublicClient, http } from 'viem'
import { createPaymasterClient, entryPoint08Address } from 'viem/account-abstraction'
import { createSmartAccountClient } from 'permissionless'
import { to7702SimpleSmartAccount } from 'permissionless/accounts'
import {
  brandTxSender,
  requireSignTypedData,
  type SeedSigner,
  type SeedTxRequest,
  type SeedTxSender,
} from '../seedSigner'
import { getPublishRpcUrl, getPublishViemChain } from '../chainConfig'
import { isManagedAccountPublishError } from '../../errors'
import { assertUserOpSucceeded, bundlerFeesPerGas } from './userOps'

export type CreatePermissionlessTxSenderOptions = {
  signer: SeedSigner
  bundlerUrl: string
  /** Sponsoring paymaster, asked with ERC-7677 `pm_getPaymasterStubData` / `pm_getPaymasterData`. Defaults to `bundlerUrl`. */
  paymasterUrl?: string
  /** `false` sends without a paymaster: the account pays its own gas. Default `true`. */
  sponsored?: boolean
}

export function seedSignerToLocalAccount(signer: SeedSigner): LocalAccount {
  return {
    address: signer.address,
    type: 'local',
    source: 'custom',
    publicKey: '0x',
    signMessage: async ({ message }: { message: SignableMessage }) =>
      signer.signMessage({ message }),
    signTransaction: async () => {
      throw new Error(
        '@seedprotocol/publish: permissionless EIP-7702 path does not use signTransaction',
      )
    },
    signTypedData: async (args) =>
      requireSignTypedData(signer)(args as Parameters<NonNullable<SeedSigner['signTypedData']>>[0]),
  }
}

/**
 * Throws when the bundler lists its EntryPoints and v0.8 is not among them (e.g. a local twin's
 * v0.6 bundler, which belongs in `PublishConfig.thirdweb.bundlerUrl`). Bundlers that do not
 * answer `eth_supportedEntryPoints` are let through.
 * @internal Exported for unit tests.
 */
export async function assertBundlerSupportsEntryPoint08(bundlerUrl: string): Promise<void> {
  let supported: unknown
  try {
    const res = await fetch(bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_supportedEntryPoints', params: [] }),
    })
    supported = ((await res.json()) as { result?: unknown }).result
  } catch {
    return
  }
  if (!Array.isArray(supported)) return
  const list = supported.map((a) => String(a).toLowerCase())
  if (list.includes(entryPoint08Address.toLowerCase())) return
  throw new Error(
    `@seedprotocol/publish: PublishConfig.bundlerUrl (${bundlerUrl}) does not support EntryPoint v0.8 (it lists ${list.join(', ') || 'none'}). ` +
      `The top-level bundlerUrl is only for the permissionless EIP-7702 sender. For Thirdweb in-app wallets (e.g. a local twin's bundler), set PublishConfig.thirdweb.bundlerUrl instead.`,
  )
}

/**
 * EIP-7702 `SeedTxSender` via permissionless `to7702SimpleSmartAccount`, sponsored by a paymaster
 * unless `sponsored` is false.
 * @throws when `bundlerUrl` reports no EntryPoint v0.8 support
 */
export async function createPermissionlessTxSender(
  options: CreatePermissionlessTxSenderOptions,
): Promise<SeedTxSender> {
  const { signer, bundlerUrl, paymasterUrl, sponsored = true } = options
  await assertBundlerSupportsEntryPoint08(bundlerUrl)
  const chain = getPublishViemChain()
  const rpcUrl = getPublishRpcUrl()
  const address = signer.address as Address

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const owner = seedSignerToLocalAccount(signer)

  const simpleAccount = await to7702SimpleSmartAccount({
    client: publicClient,
    owner,
    entryPoint: {
      address: entryPoint08Address,
      version: '0.8',
    },
  })

  const smartAccountClient = createSmartAccountClient({
    account: simpleAccount,
    chain,
    bundlerTransport: http(bundlerUrl),
    ...(sponsored ? { paymaster: createPaymasterClient({ transport: http(paymasterUrl ?? bundlerUrl) }) } : {}),
    userOperation: {
      estimateFeesPerGas: bundlerFeesPerGas(bundlerUrl, () => publicClient.estimateFeesPerGas()),
    },
  })

  return brandTxSender({
    address: (simpleAccount.address ?? address) as Address,
    sendTransaction: async (tx: SeedTxRequest) => {
      try {
        const hash = await smartAccountClient.sendUserOperation({
          calls: [{ to: tx.to, data: tx.data, value: tx.value ?? 0n }],
        })
        const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash })
        return { transactionHash: assertUserOpSucceeded(receipt, simpleAccount.address) }
      } catch (err) {
        if (isManagedAccountPublishError(err)) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `@seedprotocol/publish: permissionless/EIP-7702 send failed (${msg}). Ensure bundlerUrl/paymasterUrl support EntryPoint v0.8, or use accountMode: 'eoa' / Thirdweb adapter.`,
          { cause: err },
        )
      }
    },
  })
}
