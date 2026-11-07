import { utf8ToBytes } from '@noble/hashes/utils'
import { keccak256Hex } from './keccak.js'

const BYTES32_PREFIX = 'bytes32 '

/**
 * UID of the schema Seed attests under for `definition` (e.g. `string title`): Seed registers every
 * schema with the zero resolver and revocable, so the UID is
 * `keccak256(abi.encodePacked(definition, address(0), true))`, the same on every chain. A schema
 * with the same definition but another resolver or revocable flag has another UID and isn't
 * Seed's (ADR 0035).
 */
export function seedSchemaUid(definition: string): `0x${string}` {
  const text = utf8ToBytes(definition)
  const packed = new Uint8Array(text.length + 21)
  packed.set(text, 0)
  // 20 zero bytes for the resolver, then `true`.
  packed[text.length + 20] = 1
  return `0x${keccak256Hex(packed)}`
}

/**
 * The model name a seed schema stands for: `<name>` when `definition` is `bytes32 <name>` (ADR 0008)
 * and `schemaUid` is {@link seedSchemaUid} of it, else undefined. Names attested onto a schema
 * aren't used, since anyone can attach any name to any schema.
 */
export function seedSchemaModelName(schemaUid: string, definition: string | null | undefined): string | undefined {
  if (!definition?.startsWith(BYTES32_PREFIX)) return undefined
  const name = definition.slice(BYTES32_PREFIX.length)
  if (!name || /[\s,]/.test(name)) return undefined
  return seedSchemaUid(definition) === schemaUid.toLowerCase() ? name : undefined
}
