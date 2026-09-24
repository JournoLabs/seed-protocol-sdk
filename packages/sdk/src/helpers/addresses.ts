import type { AddressConfiguration } from '@/types'

export type NormalizedAddressConfig = { owned: string[]; watched: string[] }

/**
 * Lowercase + trim an address for persist and compare.
 * Does not checksum or validate — test and placeholder addresses must keep working.
 */
export function normalizeHexAddress(addr: string): string {
  return addr.trim().toLowerCase()
}

/**
 * Lowercase, drop empties, and dedupe (first-seen order).
 */
export function normalizeAddressList(
  addrs: readonly string[] | undefined | null,
): string[] {
  if (!addrs?.length) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const addr of addrs) {
    if (addr == null || addr === '') continue
    const normalized = normalizeHexAddress(String(addr))
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/**
 * Lowercase a publisher stamp. Empty / null → undefined (omit on write).
 */
export function normalizePublisher(
  publisher: string | null | undefined,
): string | undefined {
  if (publisher == null || publisher === '') return undefined
  const normalized = normalizeHexAddress(publisher)
  return normalized || undefined
}

/**
 * Normalizes AddressConfiguration to { owned, watched }.
 * - string[] -> { owned: addresses, watched: [] }
 * - { owned, watched? } -> { owned, watched: watched ?? [] }
 * Addresses are lowercased and deduped.
 */
export function normalizeAddressConfig(
  addresses: AddressConfiguration | undefined,
): NormalizedAddressConfig {
  if (!addresses) {
    return { owned: [], watched: [] }
  }
  if (Array.isArray(addresses)) {
    return { owned: normalizeAddressList(addresses), watched: [] }
  }
  return {
    owned: normalizeAddressList(addresses.owned),
    watched: normalizeAddressList(addresses.watched),
  }
}
