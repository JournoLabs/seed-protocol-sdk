import { CanonicalJsonError } from './errors'

export { CanonicalJsonError }

/**
 * RFC 8785 canonical JSON for the values license terms use: plain objects, arrays, strings, safe
 * integers, booleans and null. Keys sort by UTF-16 code units, which is what `Array.prototype.sort`
 * does; ECMAScript's string serialization is the one RFC 8785 specifies. Non-integer numbers are
 * refused rather than formatted, so the RFC's number rules never come into play. An object
 * property whose value is `undefined` is left out, as `JSON.stringify` does.
 */
export function canonicalJson(value: unknown): string {
  return write(value, '')
}

function write(value: unknown, path: string): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isSafeInteger(value)) throw new CanonicalJsonError(path, `${value} is not a safe integer`)
      return Object.is(value, -0) ? '0' : String(value)
    case 'object':
      break
    default:
      throw new CanonicalJsonError(path, `${typeof value} is not JSON`)
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item, i) => {
        if (item === undefined) throw new CanonicalJsonError(`${path}[${i}]`, 'undefined in an array')
        return write(item, `${path}[${i}]`)
      })
      .join(',')}]`
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) throw new CanonicalJsonError(path, 'not a plain object')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${write(record[key], path ? `${path}.${key}` : key)}`).join(',')}}`
}
