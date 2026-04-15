import { ZERO_ADDRESS } from '@ethereum-attestation-service/eas-sdk'
import { ZERO_BYTES32 } from './utils'

const BYTES32_LEN = 64

export const toHex32 = (v: unknown): string => {
  if (v == null) return '0x' + '0'.repeat(BYTES32_LEN)
  if (typeof v === 'string') {
    const raw = v.startsWith('0x') ? v.slice(2) : v
    const hex = raw.replace(/[^0-9a-fA-F]/g, '0').padStart(BYTES32_LEN, '0').slice(-BYTES32_LEN)
    return '0x' + hex
  }
  if (v instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer)) {
    const arr = v instanceof Uint8Array ? v : new Uint8Array(v)
    const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
    return '0x' + hex.padStart(BYTES32_LEN, '0').slice(-BYTES32_LEN)
  }
  return '0x' + '0'.repeat(BYTES32_LEN)
}

export const toBytesHex = (v: unknown): string => {
  if (v == null || (typeof v === 'string' && (v === '' || v === '0x'))) return '0x'
  if (typeof v === 'string') {
    const raw = v.startsWith('0x') ? v.slice(2) : v
    const hex = raw.replace(/[^0-9a-fA-F]/g, '0')
    return '0x' + (hex.length % 2 === 1 ? '0' + hex : hex)
  }
  if (v instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer)) {
    const arr = v instanceof Uint8Array ? v : new Uint8Array(v)
    return '0x' + Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return '0x'
}

/** True when an attestation still references another seed in this batch by localId (needs client-side resolution between txs). */
export function hasCrossPayloadUnresolved(reqs: unknown[]): boolean {
  const localIds = new Set(
    reqs.map((r) => (r as { localId?: string })?.localId).filter((id): id is string => !!id),
  )
  return reqs.some((req) =>
    ((req as { listOfAttestations?: unknown[] })?.listOfAttestations ?? []).some((a) => {
      const att = a as { _unresolvedValue?: string; _rawListIdsForResolve?: string[] }
      if (att._unresolvedValue && localIds.has(att._unresolvedValue)) return true
      if (Array.isArray(att._rawListIdsForResolve)) {
        return att._rawListIdsForResolve.some((id) => id && localIds.has(String(id).trim()))
      }
      return false
    }),
  )
}

/** Keep only propertiesToUpdate whose target is in the same multiPublish batch (same tx). */
export function filterPropertiesToUpdateForBatch<T extends { publishLocalId?: string }>(
  propertiesToUpdate: T[] | undefined,
  batchLocalIds: Set<string>,
): T[] {
  return (propertiesToUpdate ?? []).filter(
    (pu) => pu.publishLocalId && batchLocalIds.has(pu.publishLocalId),
  )
}

const placeholderData = {
  recipient: ZERO_ADDRESS,
  expirationTime: BigInt(0),
  revocable: true,
  refUID: ZERO_BYTES32,
  data: ZERO_BYTES32 as `0x${string}`,
  value: BigInt(0),
}

/** Normalize one publish request for SeedProtocol multiPublish (same rules as createAttestations). */
export function normalizePublishRequest(req: any): any {
  const listOfAttestations = (req?.listOfAttestations ?? []).map((att: any) => {
    const dataArr = Array.isArray(att?.data) ? att.data : []
    return {
      schema: toHex32(att?.schema),
      data: dataArr.map((d: any) => ({
        ...d,
        refUID: toHex32(d?.refUID),
        data: toBytesHex(d?.data),
        expirationTime: d?.expirationTime != null ? BigInt(d.expirationTime) : BigInt(0),
        value: d?.value != null ? BigInt(d.value) : BigInt(0),
      })),
      ...(typeof att?._propertyName === 'string' && att._propertyName !== ''
        ? { _propertyName: att._propertyName }
        : {}),
      ...(typeof att?._propertyNameForSchema === 'string' && att._propertyNameForSchema !== ''
        ? { _propertyNameForSchema: att._propertyNameForSchema }
        : {}),
    }
  })
  const propertiesToUpdate = (req?.propertiesToUpdate ?? []).map((p: any) => ({
    ...p,
    propertySchemaUid: toHex32(p?.propertySchemaUid),
  }))
  return {
    ...req,
    seedUid: toHex32(req?.seedUid),
    seedSchemaUid: toHex32(req?.seedSchemaUid),
    versionUid: toHex32(req?.versionUid),
    versionSchemaUid: toHex32(req?.versionSchemaUid),
    listOfAttestations,
    propertiesToUpdate,
  }
}

/** Ensure placeholder attestation data for contract injection targets (full batch). */
export function applyPropertiesToUpdatePlaceholders(
  normalizedRequests: any[],
  byLocalId: Map<string, any>,
): void {
  for (const req of normalizedRequests) {
    for (const pu of req?.propertiesToUpdate ?? []) {
      const targetId = pu?.publishLocalId
      const schemaUid = toHex32(pu?.propertySchemaUid)
      if (!targetId || !schemaUid) continue
      const targetReq = byLocalId.get(targetId)
      if (!targetReq?.listOfAttestations) continue
      const att = targetReq.listOfAttestations.find(
        (a: any) => toHex32(a?.schema)?.toLowerCase() === schemaUid?.toLowerCase(),
      )
      if (!att) continue
      if (!Array.isArray(att.data) || att.data.length === 0) {
        att.data = [{ ...placeholderData, refUID: ZERO_BYTES32 }]
      }
    }
  }
}
