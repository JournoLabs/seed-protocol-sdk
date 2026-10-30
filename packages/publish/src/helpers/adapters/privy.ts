import type { Address, Chain, EIP1193Provider } from 'viem'
import type { PublishWallet, PublishWalletKind, SeedSigner } from '../seedSigner'
import { getPublishViemChain } from '../chainConfig'
import { fromEip1193Provider } from './eip1193'

/**
 * The parts of a Privy `ConnectedWallet` (from `useWallets()` in `@privy-io/react-auth`) this
 * adapter uses. Declared here so the publish package doesn't depend on Privy.
 */
export type PrivyEthereumWalletLike = {
  address: string
  /** CAIP-2 (`'eip155:84532'`) or a bare chain id; Privy's own field. */
  chainId?: string | number
  switchChain(chainId: number | `0x${string}`): Promise<void>
  getEthereumProvider(): Promise<EIP1193Provider>
}

export type FromPrivyWalletOptions = {
  /** Chain to publish on. Defaults to the publish chain. */
  chain?: Chain
  /** As for `fromViemWalletClient`. Defaults to `'eoa'`, which Privy's embedded wallets are. */
  kind?: PublishWalletKind
  /** As for `fromViemWalletClient`. Privy's provider has no such method; pass its own call. */
  signAuthorization?: SeedSigner['signAuthorization']
}

function chainIdOf(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return value
  const id = Number(value.includes(':') ? value.slice(value.lastIndexOf(':') + 1) : value)
  return Number.isFinite(id) ? id : undefined
}

/**
 * Build a PublishWallet from a Privy wallet (embedded or external), switching it to the publish
 * chain first. Privy's providers don't follow a later chain switch, so the provider is fetched
 * after the switch; call this again if the app switches chains afterwards.
 */
export async function fromPrivyWallet(
  wallet: PrivyEthereumWalletLike,
  options: FromPrivyWalletOptions = {},
): Promise<PublishWallet> {
  const chain = options.chain ?? getPublishViemChain()
  if (chainIdOf(wallet.chainId) !== chain.id) {
    await wallet.switchChain(chain.id)
  }
  const provider = await wallet.getEthereumProvider()
  return fromEip1193Provider(provider, {
    chain,
    address: wallet.address as Address,
    kind: options.kind,
    signAuthorization: options.signAuthorization,
  })
}
