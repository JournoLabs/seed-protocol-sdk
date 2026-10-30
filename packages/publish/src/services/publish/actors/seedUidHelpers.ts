import { ZERO_BYTES32 } from './utils'

export function toHex32Normalized(v: string | undefined): string {
  if (v == null || v === '') return ZERO_BYTES32
  const raw = v.startsWith('0x') ? v.slice(2) : v
  const hex = raw.replace(/[^0-9a-fA-F]/g, '0').padStart(64, '0').slice(-64)
  return ('0x' + hex).toLowerCase()
}
