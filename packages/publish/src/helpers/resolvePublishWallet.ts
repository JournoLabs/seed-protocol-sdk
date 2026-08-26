import {
  isPublishWallet,
  type PublishWallet,
} from './seedSigner'
import { getPublishWallet } from './publishWalletRegistry'

/** Resolve PublishWallet from machine context or the session registry. */
export function resolvePublishWallet(source: {
  wallet?: unknown
  account?: unknown
}): PublishWallet {
  if (isPublishWallet(source.wallet)) return source.wallet
  if (isPublishWallet(source.account)) return source.account
  const registered = getPublishWallet()
  if (registered) return registered
  throw new Error(
    '@seedprotocol/publish: no PublishWallet available. Pass fromEthersWallet / fromEip1193Provider / fromThirdwebAccount, or call setPublishWallet / useSeedWallet.',
  )
}
