import { client as seedClient } from '@seedprotocol/sdk'
import type { PublishWallet, SeedSigner, SeedTxSender } from './seedSigner'

export type PublishWalletSession = PublishWallet & {
  /** Addresses to treat as owned in the Seed SDK (EOA + smart account, etc.). */
  ownedAddresses?: string[]
  /** Preferred publisher address for new seeds (defaults to signer.address). */
  publisherAddress?: string
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
    await seedClient.setAddresses({ owned: [...owned] })
  } catch (err) {
    console.warn('[publishWalletRegistry] Failed to set seed client addresses:', err)
  }
}

export function getPublishWallet(): PublishWalletSession | null {
  return session
}

export function clearPublishWallet(): void {
  session = null
}

/** Convenience for callers that only need signing. */
export function getRegisteredSigner(): SeedSigner | null {
  return session?.signer ?? null
}

/** Convenience for callers that only need sending. */
export function getRegisteredTxSender(): SeedTxSender | null {
  return session?.txSender ?? null
}
