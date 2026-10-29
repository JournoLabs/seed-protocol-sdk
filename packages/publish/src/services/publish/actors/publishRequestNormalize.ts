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

export type PropertiesToUpdateOrderViolation = {
  /** Index of the request whose propertiesToUpdate entry points backwards. */
  requestIndex: number
  /** Index of the request it updates, attested before `requestIndex`. */
  targetIndex: number
  requestLocalId: string | undefined
  targetLocalId: string
  propertySchemaUid: string | undefined
}

/**
 * The first propertiesToUpdate entry that targets an earlier request of `requests`, for the
 * direct-to-EAS route, which attests one request after another: its seed uid can never be written
 * into that request, whose attestations are already made. Targeting the request itself or a later
 * one is fine; a target outside the batch is not this check's concern. (The contract routes create
 * every seed first and accept references in any direction.)
 */
export function findPropertiesToUpdateTargetingEarlierRequest(
  requests: Array<{
    localId?: string
    propertiesToUpdate?: Array<{ publishLocalId?: string; propertySchemaUid?: string }>
  }>,
): PropertiesToUpdateOrderViolation | undefined {
  const indexOf = new Map<string, number>()
  requests.forEach((r, i) => {
    if (r?.localId && !indexOf.has(r.localId)) indexOf.set(r.localId, i)
  })
  for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
    const req = requests[requestIndex]
    for (const pu of req?.propertiesToUpdate ?? []) {
      const targetIndex = pu?.publishLocalId ? indexOf.get(pu.publishLocalId) : undefined
      if (targetIndex === undefined || targetIndex >= requestIndex) continue
      return {
        requestIndex,
        targetIndex,
        requestLocalId: req?.localId,
        targetLocalId: pu.publishLocalId!,
        propertySchemaUid: pu.propertySchemaUid,
      }
    }
  }
  return undefined
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
      ...(typeof att?._metadataLocalId === 'string' && att._metadataLocalId !== ''
        ? { _metadataLocalId: att._metadataLocalId }
        : {}),
      ...(typeof att?._attestedValue === 'string' ? { _attestedValue: att._attestedValue } : {}),
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
