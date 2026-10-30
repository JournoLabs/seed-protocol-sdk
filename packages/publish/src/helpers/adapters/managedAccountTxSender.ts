import { createPublicClient, http, type Address } from 'viem'
import { createPaymasterClient, entryPoint06Address } from 'viem/account-abstraction'
import { createSmartAccountClient } from 'permissionless'
import { toThirdwebSmartAccount } from 'permissionless/accounts'
import { requireManagedAccountFactoryAddress } from '../../config'
import { isManagedAccountPublishError } from '../../errors'
import { getPublishRpcUrl, getPublishViemChain } from '../chainConfig'
import { brandTxSender, type SeedSigner, type SeedTxSender } from '../seedSigner'
import { seedSignerToLocalAccount } from './permissionlessTxSender'
import { bundlerFeesPerGas, sendUserOpWithHeadroom, type FeesPerGas } from './userOps'

export type CreateManagedAccountTxSenderOptions = {
  /**
   * Signs the UserOps: an admin EOA of the account, or a session key it granted (which may only
   * call its approved targets). It signs each UserOp hash with `signMessage`.
   */
  signer: SeedSigner
  /** The ManagedAccount. Omit to use the account `signer` administers through the factory (counterfactual until its first UserOp). */
  managedAddress?: Address
  /** ERC-4337 bundler for EntryPoint v0.6. */
  bundlerUrl: string
  /**
   * ERC-7677 paymaster (`pm_getPaymasterStubData` / `pm_getPaymasterData`). Defaults to
   * `bundlerUrl`; ignored when `sponsored` is false.
   */
  paymasterUrl?: string
  /** `false` sends without a paymaster: the account pays its own gas. Default `true`. */
  sponsored?: boolean
  /** ManagedAccount factory. Defaults to `PublishConfig.managedAccountFactoryAddress` or the chain's built-in one. */
  factoryAddress?: Address
  /** EntryPoint v0.6 the factory's accounts use. Defaults to the canonical v0.6 address. */
  entryPointAddress?: Address
  /** Fees per UserOp. Defaults to the bundler's `pimlico_getUserOperationGasPrice`, else the chain's estimate. */
  estimateFeesPerGas?: () => Promise<FeesPerGas>
}

/**
 * `SeedTxSender` that sends each transaction as a UserOp from a Seed ManagedAccount (thirdweb's
 * account contracts, EntryPoint v0.6) through any ERC-4337 bundler, with no Thirdweb SDK.
 * `callGasLimit` gets `CALL_GAS_HEADROOM_BPS` over the bundler's estimate before the
 * paymaster signs, as `seedPaymaster` does for the thirdweb path.
 *
 * Its `address` is the account, so a session-key grant sent through it deploys an undeployed
 * account first (see `ensureAutomationSessionKey`). It can't send `installSeedExecutor`, which
 * the account accepts only from its admin EOA.
 */
export async function createManagedAccountTxSender(
  options: CreateManagedAccountTxSenderOptions,
): Promise<SeedTxSender> {
  const { signer, bundlerUrl, sponsored = true } = options
  const chain = getPublishViemChain()
  const publicClient = createPublicClient({ chain, transport: http(getPublishRpcUrl()) })

  const account = await toThirdwebSmartAccount({
    client: publicClient,
    owner: seedSignerToLocalAccount(signer),
    factoryAddress: options.factoryAddress ?? (requireManagedAccountFactoryAddress() as Address),
    entryPoint: { address: options.entryPointAddress ?? entryPoint06Address, version: '0.6' },
    ...(options.managedAddress && { address: options.managedAddress }),
  })

  const client = createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(bundlerUrl),
    ...(sponsored && {
      paymaster: createPaymasterClient({ transport: http(options.paymasterUrl ?? bundlerUrl) }),
    }),
    userOperation: {
      estimateFeesPerGas:
        options.estimateFeesPerGas ?? bundlerFeesPerGas(bundlerUrl, () => publicClient.estimateFeesPerGas()),
    },
  })

  const address = account.address

  return brandTxSender({
    address,
    sendTransaction: async (tx) => {
      try {
        return { transactionHash: await sendUserOpWithHeadroom(client, tx, address) }
      } catch (err) {
        if (isManagedAccountPublishError(err)) throw err
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(
          `@seedprotocol/publish: ManagedAccount UserOp from ${address} failed (${msg}). Check that bundlerUrl and paymasterUrl support EntryPoint v0.6 on ${chain.name}.`,
          { cause: err },
        )
      }
    },
  })
}
