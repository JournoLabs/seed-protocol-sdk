import { prepareTransaction, sendTransaction, type ThirdwebClient } from 'thirdweb'
import type { Account } from 'thirdweb/wallets'
import type { Address, Hex } from 'viem'
import {
  brandSigner,
  brandTxSender,
  isPublishWallet,
  isSeedSigner,
  type PublishWallet,
  type SeedSigner,
} from '../seedSigner'
import { getPublishThirdwebChain } from '../thirdwebChain'

export type FromThirdwebAccountOptions = {
  /**
   * Thirdweb client for `prepareTransaction`. A Thirdweb Account does not carry a client.
   * Pass the secret-key client from the server, or omit this to use `getClient()`.
   */
  client?: ThirdwebClient
}

/**
 * Wrap a Thirdweb Account so AA gas sponsorship still flows through thirdweb `sendTransaction`.
 */
export function fromThirdwebAccount(
  account: Account,
  options?: FromThirdwebAccountOptions,
): PublishWallet {
  const explicitClient = options?.client
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
      const client = explicitClient ?? (await import('../publishThirdwebClient')).getClient()
      const chain = getPublishThirdwebChain()
      const transaction = prepareTransaction({
        client,
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
  options?: FromThirdwebAccountOptions,
): PublishWallet {
  if (isPublishWallet(accountOrWallet)) return accountOrWallet
  if (isSeedSigner(accountOrWallet)) {
    throw new Error(
      '@seedprotocol/publish/thirdweb: SeedSigner alone cannot send sponsored txs. Pass fromThirdwebAccount(account) or a PublishWallet.',
    )
  }
  return fromThirdwebAccount(accountOrWallet, options)
}

/** @deprecated Prefer {@link asThirdwebPublishWallet}; kept for call-site migration. */
export function asSeedSignerFromThirdweb(
  accountOrWallet: Account | SeedSigner | PublishWallet,
): SeedSigner {
  if (isPublishWallet(accountOrWallet)) return accountOrWallet.signer
  if (isSeedSigner(accountOrWallet)) return accountOrWallet
  return fromThirdwebAccount(accountOrWallet).signer
}
