import { parseEventLogs } from 'thirdweb'
import { decodeAbiParameters } from 'viem'
import {
  createdAttestationEvent,
  seedPublishedEvent,
} from '~/helpers/thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148'
import {
  createdAttestationEvent as executorCreatedAttestationEvent,
  seedPublishedEvent as executorSeedPublishedEvent,
} from '~/helpers/thirdweb/11155420/0x043462304114da543add6b693c686b7d98865f3e'
import { ZERO_BYTES32 } from './utils'

export function toHex32Normalized(v: string | undefined): string {
  if (v == null || v === '') return ZERO_BYTES32
  const raw = v.startsWith('0x') ? v.slice(2) : v
  const hex = raw.replace(/[^0-9a-fA-F]/g, '0').padStart(64, '0').slice(-64)
  return ('0x' + hex).toLowerCase()
}

/**
 * Extract the seed attestation UID by matching the request's seedSchemaUid to a CreatedAttestation
 * event. The payload links each request to a schema (seedSchemaUid); the contract emits
 * CreatedAttestation(schemaUid, attestationUid) for each attestation, so we find the event whose
 * schemaUid matches and use its attestationUid. No index guessing.
 */
export function seedUidFromCreatedAttestationEvents(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  seedSchemaUid: string | undefined,
  useModularExecutor: boolean
): string | undefined {
  if (!seedSchemaUid || !receipt.logs?.length) return undefined
  const wantSchema = toHex32Normalized(seedSchemaUid)
  if (wantSchema === ZERO_BYTES32) return undefined
  const createdAttestationEvt = useModularExecutor ? executorCreatedAttestationEvent : createdAttestationEvent
  try {
    const parsed = parseEventLogs({
      logs: receipt.logs as import('viem').Log[],
      events: [createdAttestationEvt()],
      strict: false,
    })
    for (const ev of parsed) {
      const result = ev?.args?.result as { schemaUid?: string; attestationUid?: string } | undefined
      if (!result?.attestationUid) continue
      if (toHex32Normalized(result.schemaUid) === wantSchema) {
        const uid = result.attestationUid
        if (uid && toHex32Normalized(uid) !== ZERO_BYTES32) return uid
        return undefined
      }
    }
  } catch {
    // ignore
  }
  return undefined
}

export type SeedPublishedPair = {
  seedUid?: string
  versionUid?: string
}

/**
 * Seed + Version UIDs from SeedPublished (executor: typed args; extension: bytes32[] layout).
 * Extension layout: seed at index listOfAttestationsCount, version at listOfAttestationsCount + 1 when present.
 */
export function uidsFromSeedPublished(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  contractAddress: string,
  listOfAttestationsCount: number,
  useModularExecutor: boolean,
): SeedPublishedPair {
  const want = contractAddress.toLowerCase()
  const logs = receipt.logs?.filter((l) => l.address && l.address.toLowerCase() === want)
  if (!logs?.length) return {}
  try {
    const seedPublishedEvt = useModularExecutor ? executorSeedPublishedEvent : seedPublishedEvent
    const parsed = parseEventLogs({
      logs: logs as import('viem').Log[],
      events: [seedPublishedEvt()],
      strict: false,
    })
    const first = parsed[0]
    if (!first) return {}
    if (useModularExecutor) {
      const args = first.args as { seedUid?: string; versionUid?: string }
      const seedUid =
        args?.seedUid && toHex32Normalized(args.seedUid) !== ZERO_BYTES32 ? args.seedUid : undefined
      const versionUid =
        args?.versionUid && toHex32Normalized(args.versionUid) !== ZERO_BYTES32
          ? args.versionUid
          : undefined
      return { seedUid, versionUid }
    }
    const args = first.args as { returnedDataFromEAS?: `0x${string}` }
    const data = args?.returnedDataFromEAS
    if (!data || data === '0x') return {}
    const decoded = decodeAbiParameters([{ type: 'bytes32[]' }], data)
    const uids = decoded[0] as readonly `0x${string}`[]
    if (!uids?.length) return {}
    const seedIndex = listOfAttestationsCount
    const atSeed = uids[seedIndex]
    const atVersion = uids[seedIndex + 1]
    const seedUid =
      atSeed && atSeed !== ZERO_BYTES32
        ? (atSeed as string)
        : uids.length === 1 && uids[0] && uids[0] !== ZERO_BYTES32
          ? (uids[0] as string)
          : undefined
    const versionUid =
      atVersion && atVersion !== ZERO_BYTES32 ? (atVersion as string) : undefined
    return { seedUid, versionUid }
  } catch {
    return {}
  }
}

/**
 * Fallback: extract seed UID from SeedPublished when CreatedAttestation events are not
 * available or don't match.
 * Extension: SeedPublished(bytes returnedDataFromEAS) - decode bytes as bytes32[], use index.
 * Executor: SeedPublished(bytes32 seedUid, bytes32 versionUid) - read args.seedUid directly.
 */
export function seedUidFromSeedPublished(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  contractAddress: string,
  listOfAttestationsCount: number,
  useModularExecutor: boolean,
): string | undefined {
  return uidsFromSeedPublished(
    receipt,
    contractAddress,
    listOfAttestationsCount,
    useModularExecutor,
  ).seedUid
}

/**
 * Version attestation UID from CreatedAttestation logs (schema matches request versionSchemaUid).
 */
export function versionUidFromCreatedAttestationEvents(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  versionSchemaUid: string | undefined,
  useModularExecutor: boolean,
): string | undefined {
  if (!versionSchemaUid || !receipt.logs?.length) return undefined
  const wantSchema = toHex32Normalized(versionSchemaUid)
  if (wantSchema === ZERO_BYTES32) return undefined
  const createdAttestationEvt = useModularExecutor ? executorCreatedAttestationEvent : createdAttestationEvent
  try {
    const parsed = parseEventLogs({
      logs: receipt.logs as import('viem').Log[],
      events: [createdAttestationEvt()],
      strict: false,
    })
    for (const ev of parsed) {
      const result = ev?.args?.result as { schemaUid?: string; attestationUid?: string } | undefined
      if (!result?.attestationUid) continue
      if (toHex32Normalized(result.schemaUid) === wantSchema) {
        const uid = result.attestationUid
        if (uid && toHex32Normalized(uid) !== ZERO_BYTES32) return uid
        return undefined
      }
    }
  } catch {
    // ignore
  }
  return undefined
}

export type CreatedAttestationPair = { schemaUid: string; attestationUid: string }

/**
 * All `CreatedAttestation` (schemaUid, attestationUid) pairs from the receipt, in parse order.
 * Includes seed, version, and property attestations emitted by the Seed Protocol publish flow.
 */
export function listCreatedAttestationPairsFromReceipt(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  useModularExecutor: boolean,
): CreatedAttestationPair[] {
  if (!receipt.logs?.length) return []
  const createdAttestationEvt = useModularExecutor
    ? executorCreatedAttestationEvent
    : createdAttestationEvent
  try {
    const parsed = parseEventLogs({
      logs: receipt.logs as import('viem').Log[],
      events: [createdAttestationEvt()],
      strict: false,
    })
    const out: CreatedAttestationPair[] = []
    for (const ev of parsed) {
      const result = ev?.args?.result as
        | { schemaUid?: string; attestationUid?: string }
        | undefined
      if (!result?.attestationUid) continue
      const uid = result.attestationUid
      if (!uid || toHex32Normalized(uid) === ZERO_BYTES32) continue
      const su = result.schemaUid
      if (!su) continue
      out.push({ schemaUid: su, attestationUid: uid })
    }
    return out
  } catch {
    return []
  }
}
