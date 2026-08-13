import { encodeAbiParameters, parseEventLogs, type Log } from 'viem'
import { getPublishConfig } from '~/config'
import { easAbi } from './abi/eas'
import {
  encodeEasAttest,
  encodeEasMultiAttest,
  encodeEasMultiRevoke,
  type EasAttestParams,
  type MultiAttestationRequest,
  type MultiRevocationRequest,
} from './contracts'
import type { SeedTxRequest } from './seedSigner'

export type { EasAttestParams, MultiAttestationRequest, MultiRevocationRequest }

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
const ZERO_BYTES32 = ('0x' + '0'.repeat(64)) as `0x${string}`

/**
 * Prepares a single EAS attest call (encoded SeedTxRequest).
 */
export function prepareEasAttest(params: EasAttestParams): SeedTxRequest {
  return encodeEasAttest(params)
}

/**
 * Prepares an EAS multiAttest call for batch attestations.
 */
export function prepareEasMultiAttest(requests: MultiAttestationRequest[]): SeedTxRequest {
  return encodeEasMultiAttest(requests)
}

/**
 * Encodes a bytes32 value for Seed/Version attestation data.
 * Equivalent to Solidity abi.encode(bytes32).
 */
export function encodeBytes32(value: `0x${string}`): `0x${string}` {
  return encodeAbiParameters([{ type: 'bytes32' }], [value]) as `0x${string}`
}

/**
 * Extracts the attestation UID from an EAS attest transaction receipt.
 */
export function getAttestationUidFromReceipt(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  easContractAddress: string,
): string | undefined {
  const all = getAttestedUidsFromReceipt(receipt, easContractAddress)
  return all[0]?.uid
}

export type EasAttestedPair = { schemaUid: string; uid: string }

/**
 * All `Attested` events from the EAS contract in this receipt, in log order.
 */
export function getAttestedUidsFromReceipt(
  receipt: { logs?: Array<{ address?: string; data?: string; topics?: unknown[] }> },
  easContractAddress: string,
): EasAttestedPair[] {
  if (!receipt.logs?.length) return []
  const want = easContractAddress.toLowerCase()
  const logs = receipt.logs.filter((l) => l.address && l.address.toLowerCase() === want)
  if (!logs.length) return []
  try {
    const parsed = parseEventLogs({
      abi: easAbi,
      eventName: 'Attested',
      logs: logs as Log[],
      strict: false,
    })
    const out: EasAttestedPair[] = []
    for (const ev of parsed) {
      const uid = ev.args?.uid as string | undefined
      const schemaUid = ev.args?.schemaUID as string | undefined
      if (!uid || uid === ZERO_BYTES32) continue
      if (!schemaUid) continue
      out.push({ schemaUid, uid })
    }
    return out
  } catch {
    return []
  }
}

/**
 * Prepares an EAS multiRevoke call for batch revocation.
 */
export function prepareEasMultiRevoke(requests: MultiRevocationRequest[]): SeedTxRequest {
  void getPublishConfig() // ensure publish is initialized (eas address from config)
  return encodeEasMultiRevoke(requests)
}

export { ZERO_ADDRESS, ZERO_BYTES32 }
