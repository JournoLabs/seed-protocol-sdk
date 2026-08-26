import { prepareTransaction, sendTransaction, defineChain } from 'thirdweb'
import type { Account } from 'thirdweb/wallets'
import { optimismSepolia as thirdwebOptimismSepolia } from 'thirdweb/chains'
import type { Address, Hex } from 'viem'
import {
  brandSigner,
  brandTxSender,
  isPublishWallet,
  isSeedSigner,
  type PublishWallet,
  type SeedSigner,
} from '../seedSigner'
import { getPublishViemChain } from '../chainConfig'

function resolveThirdwebChain() {
  const viemChain = getPublishViemChain()
  if (viemChain.id === thirdwebOptimismSepolia.id) {
    return thirdwebOptimismSepolia
  }
  return defineChain({
    id: viemChain.id,
    name: viemChain.name,
    nativeCurrency: viemChain.nativeCurrency,
    rpc: viemChain.rpcUrls.default.http[0] ?? '',
  })
}

/**
 * Wrap a Thirdweb Account so AA gas sponsorship still flows through thirdweb `sendTransaction`.
 */
export function fromThirdwebAccount(account: Account): PublishWallet {
  const address = account.address as Address
  const signer = brandSigner({
    address,
    signMessage: async ({ message }) => {
      const sig = await account.signMessage({ message })
      return sig as Hex
    },
  })
  const txSender = brandTxSender({
    address,
    sendTransaction: async (tx) => {
      const { getClient } = await import('../thirdweb')
      const chain = resolveThirdwebChain()
      const transaction = prepareTransaction({
        client: getClient(),
        chain,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gas,
      })
      const result = await sendTransaction({ account, transaction })
      return { transactionHash: result.transactionHash as Hex }
    },
  })
  return { signer, txSender }
}

/**
 * Coerce Thirdweb Account, SeedSigner, or PublishWallet to PublishWallet.
 */
export function asThirdwebPublishWallet(
  accountOrWallet: Account | SeedSigner | PublishWallet,
): PublishWallet {
  if (isPublishWallet(accountOrWallet)) return accountOrWallet
  if (isSeedSigner(accountOrWallet)) {
    throw new Error(
      '@seedprotocol/publish/thirdweb: SeedSigner alone cannot send sponsored txs. Pass fromThirdwebAccount(account) or a PublishWallet.',
    )
  }
  return fromThirdwebAccount(accountOrWallet)
}

/** @deprecated Prefer {@link asThirdwebPublishWallet}; kept for call-site migration. */
export function asSeedSignerFromThirdweb(
  accountOrWallet: Account | SeedSigner | PublishWallet,
): SeedSigner {
  if (isPublishWallet(accountOrWallet)) return accountOrWallet.signer
  if (isSeedSigner(accountOrWallet)) return accountOrWallet
  return fromThirdwebAccount(accountOrWallet).signer
}
