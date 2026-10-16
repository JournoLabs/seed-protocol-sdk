import { client as seedClient } from '@seedprotocol/sdk'
import type { PublishWallet, SeedSigner, SeedTxSender } from './seedSigner'

export type PublishWalletSession = PublishWallet & {
  /** Addresses to treat as owned in the Seed SDK (EOA + smart account, etc.). */
  ownedAddresses?: string[]
  /** Preferred publisher address for new seeds (defaults to signer.address). */
  publisherAddress?: string
  /**
   * Admin (EOA) of the smart account this session publishes from, when there is one. Lets publish
   * tell an undeployed smart account from an EOA, which both have no bytecode.
   */
  adminAddress?: string
}

let session: PublishWalletSession | null = null

function waitUntilSeedInitialized(): Promise<void> {
  if (seedClient.isInitialized()) return Promise.resolve()
  return new Promise((resolve) => {
    seedClient.onReady(() => resolve())
  })
}

/**
 * Register the active publish wallet (EIP-1193, ethers, Thirdweb adapter, etc.).
 * Syncs owned addresses into the Seed SDK when possible.
 */
export async function setPublishWallet(
  next: PublishWalletSession | null,
): Promise<void> {
  session = next
  if (!next) return
  await waitUntilSeedInitialized()
  const owned = new Set<string>()
  for (const a of next.ownedAddresses ?? []) {
    if (a) owned.add(a.toLowerCase())
  }
  owned.add(next.signer.address.toLowerCase())
  owned.add(next.txSender.address.toLowerCase())
  if (next.publisherAddress) owned.add(next.publisherAddress.toLowerCase())
  try {
    // Watched addresses aren't the wallet's: keep them (setAddresses replaces both lists).
    const { watched } = await seedClient.getAddresses()
    await seedClient.setAddresses({ owned: [...owned], watched })
    const claimAs = next.publisherAddress ?? next.signer.address
    if (claimAs) {
      await seedClient.claimUnpublishedDrafts(claimAs)
    }
  } catch (err) {
    console.warn('[publishWalletRegistry] Failed to set seed client addresses:', err)
  }
}

export function getPublishWallet(): PublishWalletSession | null {
  return session
}

/**
 * Forget the publish wallet and stop treating its addresses as owned in the Seed SDK (watched
 * addresses are kept). New drafts are then signed-out drafts, editable until a wallet connects
 * and claims them; drafts stamped with the old wallet are read-only until it reconnects.
 */
export async function clearPublishWallet(): Promise<void> {
  session = null
  if (!seedClient.isInitialized()) return
  try {
    const { watched } = await seedClient.getAddresses()
    // A wallet connected while we read: its addresses win.
    if (session) return
    await seedClient.setAddresses({ owned: [], watched })
  } catch (err) {
    console.warn('[publishWalletRegistry] Failed to clear seed client owned addresses:', err)
  }
}

/** Convenience for callers that only need signing. */
export function getRegisteredSigner(): SeedSigner | null {
  return session?.signer ?? null
}

/** Convenience for callers that only need sending. */
export function getRegisteredTxSender(): SeedTxSender | null {
  return session?.txSender ?? null
}
