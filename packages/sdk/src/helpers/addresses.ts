import type { AddressConfiguration } from '@/types'

export type NormalizedAddressConfig = { owned: string[]; watched: string[] }

/**
 * Normalizes AddressConfiguration to { owned, watched }.
 * - string[] -> { owned: addresses, watched: [] }
 * - { owned, watched? } -> { owned, watched: watched ?? [] }
 */
export function normalizeAddressConfig(
  addresses: AddressConfiguration | undefined
): NormalizedAddressConfig {
  if (!addresses) {
    return { owned: [], watched: [] }
  }
  if (Array.isArray(addresses)) {
    return { owned: addresses, watched: [] }
  }
  return {
    owned: addresses.owned ?? [],
    watched: addresses.watched ?? [],
  }
}
