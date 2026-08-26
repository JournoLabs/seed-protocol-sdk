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
 * Sponsored EIP-7702 `SeedTxSender` via permissionless `to7702SimpleSmartAccount`.
 */
export async function createPermissionlessTxSender(
  options: CreatePermissionlessTxSenderOptions,
): Promise<SeedTxSender> {
  const { signer, bundlerUrl, paymasterUrl } = options
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
      try {
        const hash = (await smartAccountClient.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ?? 0n,
          gas: tx.gas,
        })) as Hash
        return { transactionHash: hash as Hex }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `@seedprotocol/publish: permissionless/EIP-7702 send failed (${msg}). Ensure bundlerUrl/paymasterUrl support EntryPoint v0.8, or use accountMode: 'eoa' / Thirdweb adapter.`,
          { cause: err },
        )
      }
    },
  })
}
