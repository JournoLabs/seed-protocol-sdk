import type { Address } from 'viem'
import { PublishNonceKeyError } from '~/errors'
import { publishNonceKey, readNonceSequence } from './pinnedNonce'
import type { SeedTxSender } from './seedSigner'

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
