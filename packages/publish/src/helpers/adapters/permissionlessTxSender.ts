import type { Address, Hex, LocalAccount, SignableMessage } from 'viem'
import { createPublicClient, http, type Hash } from 'viem'
import { entryPoint08Address } from 'viem/account-abstraction'
import { createSmartAccountClient } from 'permissionless'
import { to7702SimpleSmartAccount } from 'permissionless/accounts'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import {
  brandTxSender,
  type SeedSigner,
  type SeedTxRequest,
  type SeedTxSender,
} from '../seedSigner'
import { getPublishRpcUrl, getPublishViemChain } from '../chainConfig'
import { ManagedAccountPublishError } from '../../errors'
import { userOpFailureError } from '../describeRevert'

export type CreatePermissionlessTxSenderOptions = {
  signer: SeedSigner
  bundlerUrl: string
  paymasterUrl?: string
}

function seedSignerToLocalAccount(signer: SeedSigner): LocalAccount {
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
    signTypedData: async () => {
      throw new Error(
        '@seedprotocol/publish: signTypedData is not implemented on SeedSigner yet',
      )
    },
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
 * Sponsored EIP-7702 `SeedTxSender` via permissionless `to7702SimpleSmartAccount`.
 * @throws when `bundlerUrl` reports no EntryPoint v0.8 support
 */
export async function createPermissionlessTxSender(
  options: CreatePermissionlessTxSenderOptions,
): Promise<SeedTxSender> {
  const { signer, bundlerUrl, paymasterUrl } = options
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

  const pimlicoUrl = paymasterUrl ?? bundlerUrl
  const pimlicoClient = createPimlicoClient({
    transport: http(pimlicoUrl),
    entryPoint: {
      address: entryPoint08Address,
      version: '0.8',
    },
  })

  const smartAccountClient = createSmartAccountClient({
    account: simpleAccount,
    chain,
    bundlerTransport: http(bundlerUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  })

  return brandTxSender({
    address: (simpleAccount.address ?? address) as Address,
    sendTransaction: async (tx: SeedTxRequest) => {
      let receipt: UserOpReceiptLike
      try {
        const userOpHash = await smartAccountClient.sendUserOperation({
          calls: [{ to: tx.to, data: tx.data, value: tx.value ?? 0n }],
        })
        receipt = await smartAccountClient.waitForUserOperationReceipt({ hash: userOpHash })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `@seedprotocol/publish: permissionless/EIP-7702 send failed (${msg}). Ensure bundlerUrl/paymasterUrl support EntryPoint v0.8, or use accountMode: 'eoa' / Thirdweb adapter.`,
          { cause: err },
        )
      }
      return { transactionHash: assertUserOpSucceeded(receipt, simpleAccount.address) }
    },
  })
}

type UserOpReceiptLike = { success: boolean; reason?: string; receipt: { transactionHash: Hash } }

/**
 * Returns the transaction hash of a successful UserOp, and throws for a failed one. The
 * bundle transaction itself succeeds when a UserOp in it fails, so its receipt alone would
 * pass a failed publish off as a success.
 * @throws ManagedAccountPublishError `USEROP_REVERTED` or `USEROP_FAILED_NO_REASON`
 * @internal Exported for unit tests.
 */
export function assertUserOpSucceeded(receipt: UserOpReceiptLike, sender?: string): Hex {
  const txHash = receipt.receipt.transactionHash as Hex
  if (receipt.success) return txHash
  const reason = receipt.reason
  if (reason && !/^0x[0-9a-f]*$/i.test(reason)) {
    throw new ManagedAccountPublishError(
      `The publish UserOp in transaction ${txHash} failed: ${reason}`,
      'USEROP_REVERTED',
      sender,
    )
  }
  throw userOpFailureError({ txHash, revertData: reason as Hex | undefined, sender })
}
