import { keccak256Hex } from './keccak.js'
import { normalizeBytes32Hex, isValidEasAttestationUid } from './easUid.js'

/** EAS schema definition for tool PublishedBy sidecar attestations (revocable). */
export const PUBLISHED_BY_SCHEMA_DEF =
  'bytes32 seedUid,bytes32 versionUid,bytes32[] attestationUids,bytes32 batchHash,string toolName,string toolVersion'

/** Schema #1 display name for {@link PUBLISHED_BY_SCHEMA_DEF}. */
export const PUBLISHED_BY_SCHEMA_NAME = 'seedprotocol.publishedBy'

export type PublishedByDecoded = {
  seedUid: `0x${string}`
  versionUid: `0x${string}`
  attestationUids: `0x${string}`[]
  batchHash: `0x${string}`
  toolName: string
  toolVersion: string
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Deterministic batch hash: keccak256 of sorted UIDs concatenated (abi.encodePacked of bytes32 values).
 */
export function hashPublishedByBatch(uids: readonly string[]): `0x${string}` {
  const sorted = [...uids]
    .map((u) => normalizeBytes32Hex(u))
    .filter((u) => u !== '' && isValidEasAttestationUid(u))
    .sort()
  if (sorted.length === 0) {
    return ('0x' + keccak256Hex(new Uint8Array(0))) as `0x${string}`
  }
  const packed = new Uint8Array(sorted.length * 32)
  for (let i = 0; i < sorted.length; i++) {
    packed.set(hexToBytes(sorted[i]!), i * 32)
  }
  return ('0x' + keccak256Hex(packed)) as `0x${string}`
}

/**
 * Returns true when `batchHash` equals {@link hashPublishedByBatch} of `attestationUids`.
 */
export function verifyPublishedByBatch(params: {
  attestationUids: readonly string[]
  batchHash: string
}): boolean {
  const expected = hashPublishedByBatch(params.attestationUids)
  return normalizeBytes32Hex(expected) === normalizeBytes32Hex(params.batchHash)
}

type DecodedField = {
  name?: string
  value?: unknown
  type?: string
}

function asBytes32(value: unknown): `0x${string}` {
  if (typeof value === 'string') return normalizeBytes32Hex(value) as `0x${string}`
  if (value && typeof value === 'object' && 'hex' in (value as object)) {
    return normalizeBytes32Hex(String((value as { hex: string }).hex)) as `0x${string}`
  }
  return normalizeBytes32Hex(String(value ?? '')) as `0x${string}`
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in (value as object)) {
    return String((value as { value: unknown }).value ?? '')
  }
  return String(value ?? '')
}

/**
 * Decode PublishedBy fields from EAS `decodedDataJson` (preferred) or a JSON array of named fields.
 */
export function decodePublishedByData(data: string | DecodedField[]): PublishedByDecoded {
  const fields: DecodedField[] =
    typeof data === 'string' ? (JSON.parse(data) as DecodedField[]) : data
  const byName = new Map<string, DecodedField>()
  for (const f of fields) {
    if (f?.name) byName.set(f.name, f)
  }

  const rawUids = byName.get('attestationUids')?.value
  let attestationUids: `0x${string}`[] = []
  if (Array.isArray(rawUids)) {
    attestationUids = rawUids.map((u) => asBytes32(u))
  } else if (
    rawUids &&
    typeof rawUids === 'object' &&
    Array.isArray((rawUids as { value?: unknown }).value)
  ) {
    attestationUids = ((rawUids as { value: unknown[] }).value).map((u) => asBytes32(u))
  }

  return {
    seedUid: asBytes32(byName.get('seedUid')?.value),
    versionUid: asBytes32(byName.get('versionUid')?.value),
    attestationUids,
    batchHash: asBytes32(byName.get('batchHash')?.value),
    toolName: asString(byName.get('toolName')?.value),
    toolVersion: asString(byName.get('toolVersion')?.value),
  }
}
