import {
  createWalletClient,
  custom,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
} from 'viem'
import {
  brandSigner,
  brandTxSender,
  type PublishWallet,
  type SeedSigner,
  type SeedTxSender,
} from '../seedSigner'
import { getPublishViemChain } from '../chainConfig'

export type FromEip1193Options = {
  chain?: Chain
  /** If omitted, uses the first account from eth_requestAccounts / eth_accounts. */
  address?: Address
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

  const signer = brandSigner({
    address,
    signMessage: async ({ message }) => {
      return walletClient.signMessage({
        account: address!,
        message:
          typeof message === 'string'
            ? message
            : { raw: message.raw as Hex | Uint8Array },
      })
    },
  })

  const txSender = brandTxSender({
    address,
    sendTransaction: async (tx) => {
      const hash = await walletClient.sendTransaction({
        account: address!,
        chain,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gas,
      })
      return { transactionHash: hash }
    },
  })

  return { signer, txSender }
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

/** Expose branded helpers for composing custom EIP-1193 senders. */
export function brandEip1193Parts(signer: SeedSigner, txSender: SeedTxSender): PublishWallet {
  return {
    signer: brandSigner(signer),
    txSender: brandTxSender(txSender),
  }
}
