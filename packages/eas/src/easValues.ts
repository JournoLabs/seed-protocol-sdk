/**
 * Numeric values on EAS (ADR 0010).
 *
 * The indexer's `decodedDataJson` gives a small uint (`uint8`) as a JSON number or a numeric
 * string, and a wide one (`uint256`) as `{ type: 'BigNumber', hex }`. Seed publishes Number as a
 * decimal string and Date as `uint256` Unix seconds. {@link decodeEasNumber} reads all of these.
 * Also the empty values Seed attests for a removed property (ADR 0021).
 */

const INTEGER = /^-?\d+$/
const HEX = /^(-?)0x([0-9a-f]+)$/i

/** `uint8` … `uint256`, `int8` … `int256`, and the bare `uint`/`int`. */
export function isNumericEasType(easType: string | undefined | null): boolean {
  return typeof easType === 'string' && /^u?int\d*$/.test(easType)
}

function fromHex(hex: string): string | undefined {
  const match = HEX.exec(hex.trim())
  if (!match) return undefined
  const n = BigInt('0x' + match[2])
  return (match[1] ? -n : n).toString()
}

/**
 * The decimal string for a numeric EAS value, or undefined when it isn't numeric.
 *
 * Accepts a finite JSON number, a bigint, a decimal or `0x` hex string, and an ethers v5
 * `{ type: 'BigNumber', hex }` (or `{ _hex }`). Integer strings stay exact (`'9007199254740993'`);
 * other numbers come back as `String(Number(value))` (`'1.5'`, `'1e+21'`). Publish uses the same
 * function for the value it attests, so what is written and what is read agree.
 */
export function decodeEasNumber(value: unknown): string | undefined {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return undefined
    if (INTEGER.test(s)) return BigInt(s).toString()
    if (HEX.test(s)) return fromHex(s)
    const n = Number(s)
    return Number.isFinite(n) ? String(n) : undefined
  }
  if (value && typeof value === 'object') {
    const hex = (value as { hex?: unknown; _hex?: unknown }).hex ?? (value as { _hex?: unknown })._hex
    if (typeof hex === 'string') return fromHex(hex)
  }
  return undefined
}

/**
 * Whether an attested value is the empty value Seed attests to record a property's removal
 * (ADR 0021): `''` for a `string`, a zero `bytes32`. Readers treat the property as absent. An
 * empty `bytes32[]` is an empty list, not a removal.
 */
export function isEasEmptyValue(easType: string | undefined | null, value: unknown): boolean {
  if (easType === 'string') return value === ''
  if (easType === 'bytes32') return typeof value === 'string' && /^0x0{64}$/i.test(value)
  return false
}
