import type { Address } from 'viem'
import { entryPoint06Address } from 'viem/account-abstraction'
import { findPublishAttemptsByNonceKey } from '@seedprotocol/sdk'
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
 * The EntryPoint nonce key for part `part` (default 1) of a publish sent with
 * `CreatePublishOptions.nonceKey`, once it is known to be usable: a pinning sender, a publish through
 * the Seed contract, and no UserOp landed under that part's key yet.
 * @throws PublishNonceKeyError when any of those fails; nothing has been sent
 */
export async function usableHostNonceKey(params: {
  nonceKey: string
  part?: number
  sender: Pick<SeedTxSender, 'address' | 'pinsNonceOn'> | undefined
  directEas: boolean
}): Promise<bigint> {
  const { nonceKey, part = 1, sender, directEas } = params
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
  const key = publishNonceKey(nonceKey, part)
  if ((await readNonceSequence(sender.pinsNonceOn as Address, sender.address as Address, key)) > 0n) {
    // A row under the key says what happened to it here (a reverted part, say). With none, a UserOp
    // landed that this database never recorded: another database started the publish, or its rows
    // are gone. Recovering from the chain isn't something a retry can do.
    const explained = (await findPublishAttemptsByNonceKey(key.toString()).catch(() => [{}])).length > 0
    throw new PublishNonceKeyError(
      explained
        ? `A UserOp from ${sender.address} already landed under this nonceKey, so this publish can't. ` +
            'findPublishByNonceKey says whether it attested or reverted.'
        : `A UserOp from ${sender.address} already landed under this nonceKey${part > 1 ? ` (part ${part})` : ''}, ` +
            'and this database has no record of it, so the publish is partly on chain. ' +
            'findPublishByNonceKey lists what landed in its `parts`. A split publish under a host nonceKey ' +
            'finishes only from the database that started it, so this one cannot continue it.',
      'NONCE_KEY_SPENT',
      nonceKey,
      sender.address,
    )
  }
  return key
}
