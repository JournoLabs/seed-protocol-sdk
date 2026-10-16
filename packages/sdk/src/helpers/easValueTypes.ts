import { decodeEasNumber, isNumericEasType } from '@seedprotocol/eas'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'
import { normalizeDataType } from '@/helpers/property'

/**
 * Whether an attestation's EAS type fits a local property (ADR 0008 "property types must agree",
 * ADR 0010). The type publish writes for the property always fits. A Number also takes every
 * integer type (older SDKs published `uint8`, other SDKs may use `uint256` or `int256`) and a
 * `string` whose value is numeric, which is what keeps a Text value out of a Number property that
 * shares its EAS schema. An attestation with no type, or a property with no known type, fits.
 */
export function easTypeFitsProperty(
  dataType: string | undefined,
  easType: string | undefined,
  value: unknown,
): boolean {
  if (!easType) return true
  const local = normalizeDataType(dataType)
  if (local === 'Number') {
    return isNumericEasType(easType) || (easType === 'string' && decodeEasNumber(value) !== undefined)
  }
  const expected = (INTERNAL_DATA_TYPES as Record<string, { eas?: string }>)[local]?.eas
  return !expected || expected === easType
}

/**
 * The value to store for a synced attestation, given the local property's type: a Number as its
 * decimal string, a Date published as Unix seconds as an ISO string, and any other integer value
 * as its decimal string instead of the indexer's `{ type: 'BigNumber', hex }`. Undefined: a
 * Number or Date value that doesn't decode.
 */
export function syncedPropertyValue(
  dataType: string | undefined,
  easType: string | undefined,
  value: unknown,
): unknown {
  const local = dataType ? normalizeDataType(dataType) : undefined
  if (local === 'Number') return decodeEasNumber(value)
  if (local === 'Date' && isNumericEasType(easType)) {
    const seconds = decodeEasNumber(value)
    if (seconds === undefined) return undefined
    const date = new Date(Number(seconds) * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (isNumericEasType(easType) && typeof value !== 'string') return decodeEasNumber(value) ?? value
  return value
}
