import { parseEventLogs, decodeAbiParameters, type Log } from 'viem'
import { publisherEventsAbi } from '~/helpers/abi/publisher'
import { executorEventsAbi } from '~/helpers/abi/executor'
import { getAttestedUidsFromReceipt } from '~/helpers/easDirect'
import { listCreatedAttestationPairsFromReceipt, toHex32Normalized } from './seedUidHelpers'
import { ZERO_BYTES32 } from './utils'

type ReceiptLike = {
  logs?: Array<{ address?: string; data?: string; topics?: unknown[] }>
}

/** The fields of a normalized multiPublish request this module reads. */
export type MultiPublishRequestLike = {
  localId?: string
  seedUid?: string
  seedSchemaUid?: string
  versionUid?: string
  versionSchemaUid?: string
  listOfAttestations?: Array<{ schema?: string; data?: unknown[]; _propertyName?: string }>
}

export type AttributedPropertyPair = {
  schemaUid: string
  attestationUid: string
  propertyName?: string
}

/** What one request of a multiPublish transaction created. */
export type RequestAttestations = {
  /** Seed attestation created for the request (only when it had no seed uid). */
  seedUid?: string
  /** Version attestation created for the request (only when it had no version uid). */
  versionUid?: string
  propertyPairs: AttributedPropertyPair[]
}

const isZero = (uid: string | undefined): boolean =>
  !uid || toHex32Normalized(uid) === ZERO_BYTES32

const sameSchema = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && toHex32Normalized(a) === toHex32Normalized(b)

/** Property attestations EAS creates for one request: one per data entry of each list entry. */
function expandPropertySlots(
  req: MultiPublishRequestLike,
): Array<{ schema?: string; propertyName?: string }> {
  const out: Array<{ schema?: string; propertyName?: string }> = []
  for (const att of req.listOfAttestations ?? []) {
    const count = Array.isArray(att?.data) ? att.data.length : 1
    const propertyName =
      typeof att?._propertyName === 'string' && att._propertyName !== '' ? att._propertyName : undefined
    for (let k = 0; k < count; k++) out.push({ schema: att?.schema, propertyName })
  }
  return out
}

type SeedPublishedEvent = { seedUid?: string; versionUid?: string; uids?: readonly string[] }

function seedPublishedEvents(
  receipt: ReceiptLike,
  contractAddress: string,
  useModularExecutor: boolean,
): SeedPublishedEvent[] {
  const want = contractAddress.toLowerCase()
  const logs = receipt.logs?.filter((l) => l.address && l.address.toLowerCase() === want)
  if (!logs?.length) return []
  try {
    if (useModularExecutor) {
      return parseEventLogs({
        abi: executorEventsAbi,
        eventName: 'SeedPublished',
        logs: logs as Log[],
        strict: false,
      }).map((ev) => {
        const args = ev.args as { seedUid?: string; versionUid?: string }
        return {
          seedUid: isZero(args?.seedUid) ? undefined : args.seedUid,
          versionUid: isZero(args?.versionUid) ? undefined : args.versionUid,
        }
      })
    }
    return parseEventLogs({
      abi: publisherEventsAbi,
      eventName: 'SeedPublished',
      logs: logs as Log[],
      strict: false,
    }).map((ev) => {
      const data = (ev.args as { returnedDataFromEAS?: `0x${string}` })?.returnedDataFromEAS
      if (!data || data === '0x') return { uids: [] }
      try {
        const decoded = decodeAbiParameters([{ type: 'bytes32[]' }], data)
        return { uids: (decoded[0] as readonly string[]) ?? [] }
      } catch {
        return { uids: [] }
      }
    })
  } catch {
    return []
  }
}

/**
 * Splits a multiPublish receipt into what each request created, in request order.
 *
 * None of the contract's events names the request it belongs to, but the contract handles the
 * requests one after another (SeedProtocolExecutor / SeedProtocolExtensionBase `multiPublish`), so
 * each kind of event appears in request order:
 * - CreatedAttestation: the request's seed (when its seedUid was zero), then its version (when its
 *   versionUid was zero).
 * - EAS Attested: one per property attestation (EAS also emits one for each seed/version; those are
 *   the CreatedAttestation uids and are skipped).
 * - SeedPublished: executor `(seedUid, versionUid)`, only for a request with property attestations;
 *   extension `bytes32[]` of the property uids, for every request.
 * Each stream is consumed with its own cursor. When CreatedAttestation carries more events than
 * the seeds and versions created (an older contract that also reported property attestations
 * there), the properties are read from it instead of from EAS Attested.
 */
export function attributeMultiPublishReceipt(params: {
  receipt: ReceiptLike
  requests: MultiPublishRequestLike[]
  useModularExecutor: boolean
  easContractAddress: string
  contractAddressForEvents: string
}): RequestAttestations[] {
  const { receipt, requests, useModularExecutor, easContractAddress, contractAddressForEvents } = params
  const created = listCreatedAttestationPairsFromReceipt(receipt, useModularExecutor)
  // EAS also reports the seeds and versions: drop them by uid, or by schema when the contract's
  // CreatedAttestation events are missing (a property schema is never a seed or version schema).
  const createdUids = new Set(created.map((c) => toHex32Normalized(c.attestationUid)))
  const seedVersionSchemas = new Set<string>()
  for (const r of requests) {
    if (isZero(r.seedUid) && r.seedSchemaUid) seedVersionSchemas.add(toHex32Normalized(r.seedSchemaUid))
    if (isZero(r.versionUid) && r.versionSchemaUid) {
      seedVersionSchemas.add(toHex32Normalized(r.versionSchemaUid))
    }
  }
  const attested = getAttestedUidsFromReceipt(receipt, easContractAddress)
    .filter(
      (a) =>
        !createdUids.has(toHex32Normalized(a.uid)) &&
        !seedVersionSchemas.has(toHex32Normalized(a.schemaUid)),
    )
    .map((a) => ({ schemaUid: a.schemaUid, attestationUid: a.uid }))
  const published = seedPublishedEvents(receipt, contractAddressForEvents, useModularExecutor)

  const slotsByRequest = requests.map(expandPropertySlots)
  const seedVersionCount = requests.reduce(
    (n, r) => n + (isZero(r.seedUid) ? 1 : 0) + (isZero(r.versionUid) ? 1 : 0),
    0,
  )
  const propertyCount = slotsByRequest.reduce((n, s) => n + s.length, 0)
  const propertiesInCreated = propertyCount > 0 && created.length >= seedVersionCount + propertyCount

  let createdAt = 0
  let attestedAt = 0
  let publishedAt = 0
  const takeCreated = (schemaUid: string | undefined): string | undefined => {
    const next = created[createdAt]
    if (!next) return undefined
    createdAt += 1
    return sameSchema(next.schemaUid, schemaUid) ? next.attestationUid : undefined
  }

  return requests.map((req, i) => {
    const slots = slotsByRequest[i]!
    const out: RequestAttestations = { propertyPairs: [] }
    if (isZero(req.seedUid)) out.seedUid = takeCreated(req.seedSchemaUid)
    if (isZero(req.versionUid)) out.versionUid = takeCreated(req.versionSchemaUid)

    let propertySource: Array<{ schemaUid?: string; attestationUid: string } | undefined> = []
    if (propertiesInCreated) {
      propertySource = created.slice(createdAt, createdAt + slots.length)
      createdAt += slots.length
    } else if (attested.length) {
      propertySource = attested.slice(attestedAt, attestedAt + slots.length)
      attestedAt += slots.length
    }

    const emitsSeedPublished = !useModularExecutor || slots.length > 0
    const event = emitsSeedPublished ? published[publishedAt++] : undefined
    if (event) {
      if (useModularExecutor) {
        if (isZero(req.seedUid) && !out.seedUid) out.seedUid = event.seedUid
        if (isZero(req.versionUid) && !out.versionUid) out.versionUid = event.versionUid
      } else if (event.uids?.length) {
        // Property uids first; a legacy layout appended the seed and version uids after them.
        if (!propertySource.length && event.uids.length >= slots.length) {
          propertySource = event.uids.slice(0, slots.length).map((u) => ({ attestationUid: u }))
        }
        const legacySeed = event.uids[slots.length]
        const legacyVersion = event.uids[slots.length + 1]
        if (isZero(req.seedUid) && !out.seedUid && !isZero(legacySeed)) out.seedUid = legacySeed
        if (isZero(req.versionUid) && !out.versionUid && !isZero(legacyVersion)) {
          out.versionUid = legacyVersion
        }
      }
    }

    slots.forEach((slot, j) => {
      const got = propertySource[j]
      if (!got || isZero(got.attestationUid)) return
      // A uid from SeedPublished has no schema of its own; one from an event must match the slot.
      if (got.schemaUid && !sameSchema(got.schemaUid, slot.schema)) return
      const schemaUid = got.schemaUid ?? slot.schema
      if (!schemaUid) return
      out.propertyPairs.push({
        schemaUid,
        attestationUid: got.attestationUid,
        ...(slot.propertyName ? { propertyName: slot.propertyName } : {}),
      })
    })
    return out
  })
}
