import type { Address } from 'viem'
import { entryPoint06Address } from 'viem/account-abstraction'
import { getPublishConfig } from '~/config'
import { PublishNonceKeyError } from '~/errors'
import { publishNonceKey, readNonceSequence } from './pinnedNonce'
import { sendsAsManagedAccount, type PublishWallet, type SeedTxSender } from './seedSigner'

/**
 * The sender a publish through the Seed contract sends from, for checking a nonce key before the
 * uploads. With `useModularExecutor`, a wallet that isn't an active automation session key and
 * doesn't send as the ManagedAccount itself (ConnectButton's in-app wallet) is swapped for the
 * connected ManagedAccount, which pins its nonce on EntryPoint v0.6: the same swap
 * `resolveMultiPublishSender` makes before it sends.
 */
export async function nonceKeySender(
  wallet: PublishWallet,
  address: string,
): Promise<Pick<SeedTxSender, 'address' | 'pinsNonceOn'>> {
  if (!getPublishConfig().useModularExecutor || sendsAsManagedAccount(wallet, address)) return wallet.txSender
  const sessionKey = wallet.signer?.address
  if (sessionKey) {
    const { isAutomationSessionActive } = await import('./ensureAutomationSessionKey')
    if (await isAutomationSessionActive(address, sessionKey)) return wallet.txSender
  }
  const { getConnectedManagedAccountAddress } = await import('./thirdweb')
  const { getPublishThirdwebChain } = await import('./thirdwebChain')
  const managed = (await getConnectedManagedAccountAddress(getPublishThirdwebChain())) as Address
  return { address: managed, pinsNonceOn: entryPoint06Address }
}

/**
 * The EntryPoint nonce key for `CreatePublishOptions.nonceKey`, once it is known to be usable: a
 * pinning sender, a publish through the Seed contract, and no UserOp landed under it yet.
 * @throws PublishNonceKeyError when any of those fails; nothing has been sent
 */
export async function usableHostNonceKey(params: {
  nonceKey: string
  sender: Pick<SeedTxSender, 'address' | 'pinsNonceOn'> | undefined
  directEas: boolean
}): Promise<bigint> {
  const { nonceKey, sender, directEas } = params
  if (directEas) {
    throw new PublishNonceKeyError(
      'nonceKey needs a publish through the Seed contract; attesting directly to EAS sends several transactions, which one key can\'t cover.',
      'NONCE_KEY_DIRECT_EAS',
      nonceKey,
      sender?.address,
    )
  }
  if (!sender?.pinsNonceOn) {
    throw new PublishNonceKeyError(
      'nonceKey needs a publish wallet that pins its nonce: createManagedAccountTxSender, createPermissionlessTxSender, ' +
        'or fromThirdwebAccount(account, { pinsNonce: true }) on a wallet whose getAccountNonce is seedAccountNonce.',
      'NONCE_KEY_NOT_PINNED',
      nonceKey,
      sender?.address,
    )
  }
  const key = publishNonceKey(nonceKey)
  if ((await readNonceSequence(sender.pinsNonceOn as Address, sender.address as Address, key)) > 0n) {
    throw new PublishNonceKeyError(
      `A UserOp from ${sender.address} already landed under this nonceKey, so this publish can't. ` +
        'findPublishByNonceKey says whether it attested or reverted.',
      'NONCE_KEY_SPENT',
      nonceKey,
      sender.address,
    )
  }
  return key
}
