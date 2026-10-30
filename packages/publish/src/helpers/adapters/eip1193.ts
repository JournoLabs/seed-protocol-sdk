import {
  createWalletClient,
  custom,
  type Address,
  type Chain,
  type EIP1193Provider,
} from 'viem'
import type { PublishWallet, PublishWalletKind, SeedSigner } from '../seedSigner'
import { getPublishViemChain } from '../chainConfig'
import { fromViemWalletClient } from './viemWalletClient'

export type FromEip1193Options = {
  chain?: Chain
  /** If omitted, uses the first account from eth_requestAccounts / eth_accounts. */
  address?: Address
  /** As for `fromViemWalletClient`. Defaults to `'eoa'`. */
  kind?: PublishWalletKind
  /** As for `fromViemWalletClient`. */
  signAuthorization?: SeedSigner['signAuthorization']
}

/**
 * Build a PublishWallet from an EIP-1193 provider (MetaMask, Rabby, injected wallets, etc.).
 * Transaction sends are EOA (user pays gas). Pair with permissionless for sponsored EIP-7702.
 */
export async function fromEip1193Provider(
  provider: EIP1193Provider,
  options: FromEip1193Options = {},
): Promise<PublishWallet> {
  const chain = options.chain ?? getPublishViemChain()
  let address = options.address
  if (!address) {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
    if (!accounts?.[0]) {
      throw new Error('@seedprotocol/publish: EIP-1193 provider returned no accounts')
    }
    address = accounts[0] as Address
  }

  const walletClient = createWalletClient({
    account: address,
    chain,
    transport: custom(provider),
  })
  return fromViemWalletClient(walletClient, {
    chain,
    kind: options.kind,
    signAuthorization: options.signAuthorization,
  })
}

/** Convenience: wrap window.ethereum when present. */
export async function fromWindowEthereum(
  options: FromEip1193Options = {},
): Promise<PublishWallet> {
  const eth = (globalThis as { ethereum?: EIP1193Provider }).ethereum
  if (!eth) {
    throw new Error('@seedprotocol/publish: window.ethereum is not available')
  }
  return fromEip1193Provider(eth, options)
}
