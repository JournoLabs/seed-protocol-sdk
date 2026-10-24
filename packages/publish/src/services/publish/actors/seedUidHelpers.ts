import { parseEventLogs, decodeAbiParameters, type Log } from 'viem'
import { publisherEventsAbi } from '~/helpers/abi/publisher'
import { executorEventsAbi } from '~/helpers/abi/executor'
import { getAttestedUidsFromReceipt } from '~/helpers/easDirect'
import { ZERO_BYTES32 } from './utils'

export function toHex32Normalized(v: string | undefined): string {
  if (v == null || v === '') return ZERO_BYTES32
  const raw = v.startsWith('0x') ? v.slice(2) : v
  const hex = raw.replace(/[^0-9a-fA-F]/g, '0').padStart(64, '0').slice(-64)
  return ('0x' + hex).toLowerCase()
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

function nonModularSeedPublishedUids(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  contractAddress: string,
): readonly `0x${string}`[] {
  const want = contractAddress.toLowerCase()
  const logs = receipt.logs?.filter((l) => l.address && l.address.toLowerCase() === want)
  if (!logs?.length) return []
  try {
    const parsed = parseEventLogs({
      abi: publisherEventsAbi,
      eventName: 'SeedPublished',
      logs: logs as Log[],
      strict: false,
    })
    const first = parsed[0]
    if (!first) return []
    const args = first.args as { returnedDataFromEAS?: `0x${string}` }
    const data = args?.returnedDataFromEAS
    if (!data || data === '0x') return []
    const decoded = decodeAbiParameters([{ type: 'bytes32[]' }], data)
    return (decoded[0] as readonly `0x${string}`[]) ?? []
  } catch {
    return []
  }
}

function propertyPairsFromNonModularSeedPublished(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  contractAddress: string,
  listOfAttestations: Array<{ schema?: string }>,
): CreatedAttestationPair[] {
  if (!listOfAttestations.length) return []
  const uids = nonModularSeedPublishedUids(receipt, contractAddress)
  const n = listOfAttestations.length
  if (uids.length < n) return []
  const out: CreatedAttestationPair[] = []
  for (let i = 0; i < n; i++) {
    const uid = uids[i]
    const schemaUid = listOfAttestations[i]?.schema
    if (!uid || toHex32Normalized(uid) === ZERO_BYTES32 || !schemaUid) continue
    out.push({ schemaUid, attestationUid: uid })
  }
  return out
}

export type ListPropertyAttestationPairsParams = {
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> }
  useModularExecutor: boolean
  easContractAddress: string
  contractAddressForEvents: string
  /** Used to zip non-modular SeedPublished property UIDs (indices 0..n-1) with schemas. */
  listOfAttestations?: Array<{ schema?: string }>
}

/**
 * Property (and seed/version) attestation pairs from a multiPublish receipt.
 * Order: CreatedAttestation, then EAS Attested, then non-modular SeedPublished bytes32[0..n-1].
 * Modular SeedPublished is seed+version only and is not a property source.
 */
export function listPropertyAttestationPairsFromReceipt(
  params: ListPropertyAttestationPairsParams,
): CreatedAttestationPair[] {
  const created = listCreatedAttestationPairsFromReceipt(
    params.receipt,
    params.useModularExecutor,
  )
  if (created.length) return created

  const attested = getAttestedUidsFromReceipt(params.receipt, params.easContractAddress)
  if (attested.length) {
    return attested.map((a) => ({
      schemaUid: a.schemaUid,
      attestationUid: a.uid,
    }))
  }

  if (params.useModularExecutor) return []

  return propertyPairsFromNonModularSeedPublished(
    params.receipt,
    params.contractAddressForEvents,
    params.listOfAttestations ?? [],
  )
}
