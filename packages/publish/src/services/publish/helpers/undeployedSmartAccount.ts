import type { Address } from 'viem'
import { readFactoryGetAddress } from '~/helpers/contracts'
import { getPublishWallet } from '~/helpers/publishWalletRegistry'
import type { PublishWallet } from '~/helpers/seedSigner'

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

/**
 * For a publisher address with no bytecode, says why it must not attest straight to EAS, or
 * returns null when it can (an EOA).
 *
 * - The wallet sends from another address: EAS would record that address as the attester.
 * - The publisher is the ManagedAccount factory address of a known admin (the wallet's signer,
 *   or an admin / owned address of the registered session): it is a smart account that is not
 *   deployed yet. Direct EAS would attest one transaction per Seed and deploy the account as a
 *   side effect, instead of the account's multiPublish.
 *
 * Factory reads that fail (no factory configured, RPC error) rule that admin out.
 */
export async function undeployedPublisherProblem(
  publisherAddress: string,
  wallet: Partial<PublishWallet> | undefined,
): Promise<'sender_is_not_publisher' | 'undeployed_smart_account' | null> {
  const sender = wallet?.txSender?.address
  if (sender && !sameAddress(sender, publisherAddress)) return 'sender_is_not_publisher'

  const session = getPublishWallet()
  const candidates = new Set<string>()
  for (const a of [
    wallet?.signer?.address,
    session?.adminAddress,
    session?.signer.address,
    ...(session?.ownedAddresses ?? []),
  ]) {
    if (a && !sameAddress(a, publisherAddress)) candidates.add(a.toLowerCase())
  }
  for (const admin of candidates) {
    try {
      const predicted = await readFactoryGetAddress(admin as Address)
      if (sameAddress(predicted, publisherAddress)) return 'undeployed_smart_account'
    } catch {
      // Not a factory account for this admin, or no factory on this chain.
    }
  }
  return null
}
