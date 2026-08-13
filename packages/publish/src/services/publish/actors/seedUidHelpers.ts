import { parseEventLogs, decodeAbiParameters, type Log } from 'viem'
import { publisherEventsAbi } from '~/helpers/abi/publisher'
import { executorEventsAbi } from '~/helpers/abi/executor'
import { ZERO_BYTES32 } from './utils'

export function toHex32Normalized(v: string | undefined): string {
  if (v == null || v === '') return ZERO_BYTES32
  const raw = v.startsWith('0x') ? v.slice(2) : v
  const hex = raw.replace(/[^0-9a-fA-F]/g, '0').padStart(64, '0').slice(-64)
  return ('0x' + hex).toLowerCase()
}

/**
 * Extract the seed attestation UID by matching the request's seedSchemaUid to a CreatedAttestation
 * event.
 */
export function seedUidFromCreatedAttestationEvents(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  seedSchemaUid: string | undefined,
  useModularExecutor: boolean,
): string | undefined {
  if (!seedSchemaUid || !receipt.logs?.length) return undefined
  const wantSchema = toHex32Normalized(seedSchemaUid)
  if (wantSchema === ZERO_BYTES32) return undefined
  const abi = useModularExecutor ? executorEventsAbi : publisherEventsAbi
  try {
    const parsed = parseEventLogs({
      abi,
      eventName: 'CreatedAttestation',
      logs: receipt.logs as Log[],
      strict: false,
    })
    for (const ev of parsed) {
      const result = ev.args?.result as { schemaUid?: string; attestationUid?: string } | undefined
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
    if (useModularExecutor) {
      const parsed = parseEventLogs({
        abi: executorEventsAbi,
        eventName: 'SeedPublished',
        logs: logs as Log[],
        strict: false,
      })
      const first = parsed[0]
      if (!first) return {}
      const args = first.args as { seedUid?: string; versionUid?: string }
      const seedUid =
        args?.seedUid && toHex32Normalized(args.seedUid) !== ZERO_BYTES32 ? args.seedUid : undefined
      const versionUid =
        args?.versionUid && toHex32Normalized(args.versionUid) !== ZERO_BYTES32
          ? args.versionUid
          : undefined
      return { seedUid, versionUid }
    }
    const parsed = parseEventLogs({
      abi: publisherEventsAbi,
      eventName: 'SeedPublished',
      logs: logs as Log[],
      strict: false,
    })
    const first = parsed[0]
    if (!first) return {}
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

export function versionUidFromCreatedAttestationEvents(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  versionSchemaUid: string | undefined,
  useModularExecutor: boolean,
): string | undefined {
  if (!versionSchemaUid || !receipt.logs?.length) return undefined
  const wantSchema = toHex32Normalized(versionSchemaUid)
  if (wantSchema === ZERO_BYTES32) return undefined
  const abi = useModularExecutor ? executorEventsAbi : publisherEventsAbi
  try {
    const parsed = parseEventLogs({
      abi,
      eventName: 'CreatedAttestation',
      logs: receipt.logs as Log[],
      strict: false,
    })
    for (const ev of parsed) {
      const result = ev.args?.result as { schemaUid?: string; attestationUid?: string } | undefined
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

export function listCreatedAttestationPairsFromReceipt(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  useModularExecutor: boolean,
): CreatedAttestationPair[] {
  if (!receipt.logs?.length) return []
  const abi = useModularExecutor ? executorEventsAbi : publisherEventsAbi
  try {
    const parsed = parseEventLogs({
      abi,
      eventName: 'CreatedAttestation',
      logs: receipt.logs as Log[],
      strict: false,
    })
    const out: CreatedAttestationPair[] = []
    for (const ev of parsed) {
      const result = ev.args?.result as
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
