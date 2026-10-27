import { getPublishWallet } from '~/helpers/publishWalletRegistry'
import type { PublishWallet } from '~/helpers/seedSigner'

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

export type DirectEasProblem =
  | 'sender_is_not_publisher'
  | 'smart_account'
  | 'unknown_wallet_kind'
  | 'signer_is_not_publisher'

/**
 * For a publisher address with no bytecode, says why it must not attest straight to EAS, or
 * returns null when it may: the wallet says it is an EOA (`kind: 'eoa'`) and its signer is the
 * publisher. An address with no code can be an EOA or an undeployed smart account, and the
 * address alone can't tell (a thirdweb smart wallet's signer address is the smart account), so
 * the wallet has to say (`useDirectEas` skips this check).
 *
 * - The wallet sends from another address: EAS would record that address as the attester.
 * - `kind: 'smart'` or `'modular'`: the publisher is an undeployed smart account; direct EAS would
 *   attest one transaction per Seed instead of the account's multiPublish.
 * - No kind: unknown, refused rather than guessed.
 * - An EOA whose signer isn't the publisher: it would attest as someone else.
 *
 * A wallet passed without a kind takes the registered session's kind when it's the same signer.
 */
export function directEasProblem(
  publisherAddress: string,
  wallet: Partial<PublishWallet> | undefined,
): DirectEasProblem | null {
  const sender = wallet?.txSender?.address
  if (sender && !sameAddress(sender, publisherAddress)) return 'sender_is_not_publisher'

  const session = getPublishWallet()
  const kind =
    wallet?.kind ??
    (session && sameAddress(session.signer.address, wallet?.signer?.address) ? session.kind : undefined)
  if (kind === 'smart' || kind === 'modular') return 'smart_account'
  if (kind !== 'eoa') return 'unknown_wallet_kind'
  if (!sameAddress(wallet?.signer?.address, publisherAddress)) return 'signer_is_not_publisher'
  return null
}
