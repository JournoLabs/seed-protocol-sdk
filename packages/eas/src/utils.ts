import { keccak256Hex } from './keccak.js'

export const toSnakeCase = (str: string): string =>
  str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()

/** EIP-55 checksum for a 20-byte hex address (with or without 0x prefix). */
export function checksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, '')
  if (addr.length !== 40 || !/^[0-9a-f]+$/.test(addr)) {
    return address
  }
  const hash = keccak256Hex(addr)
  let result = '0x'
  for (let i = 0; i < 40; i++) {
    result += parseInt(hash[i]!, 16) >= 8 ? addr[i]!.toUpperCase() : addr[i]!
  }
  return result
}

/**
 * `addresses` as easscan stores them (EIP-55 checksummed), for an `attester` or `recipient`
 * `in` filter: easscan compares addresses case-sensitively. Values that aren't 20-byte hex
 * addresses are dropped, since they can't match.
 */
export function checksumAddresses(addresses: readonly string[]): string[] {
  const out = new Set<string>()
  for (const address of addresses) {
    const trimmed = address.trim()
    if (/^(0x)?[0-9a-fA-F]{40}$/.test(trimmed)) out.add(checksumAddress(trimmed))
  }
  return [...out]
}
