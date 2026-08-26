export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ZERO_BYTES = '0x'
export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

export const EAS_ENDPOINT =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_EAS_ENDPOINT) ||
  (typeof process !== 'undefined' && process.env?.EAS_ENDPOINT) ||
  'https://optimism-sepolia.easscan.org/graphql'
