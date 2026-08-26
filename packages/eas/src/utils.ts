import { keccak256 } from 'js-sha3'

export const toSnakeCase = (str: string): string =>
  str.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()

/** EIP-55 checksum for a 20-byte hex address (with or without 0x prefix). */
export function checksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, '')
  if (addr.length !== 40 || !/^[0-9a-f]+$/.test(addr)) {
    return address
  }
  const hash = keccak256(addr)
  let result = '0x'
  for (let i = 0; i < 40; i++) {
    result += parseInt(hash[i]!, 16) >= 8 ? addr[i]!.toUpperCase() : addr[i]!
  }
  return result
}
