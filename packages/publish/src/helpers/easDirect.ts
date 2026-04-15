import { getContract, prepareContractCall, prepareEvent, parseEventLogs } from 'thirdweb'
import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { encodeAbiParameters } from 'viem'
import { getPublishConfig } from '~/config'

/**
 * EAS contract custom errors. Included so viem can decode revert data instead of
 * throwing AbiErrorSignatureNotFoundError (e.g. for AccessDenied 0x4ca88867).
 */
const EAS_ERRORS_ABI = [
  { type: 'error' as const, name: 'AccessDenied', inputs: [] },
  { type: 'error' as const, name: 'AlreadyRevoked', inputs: [] },
  { type: 'error' as const, name: 'InvalidRevocation', inputs: [] },
  { type: 'error' as const, name: 'InvalidRevocations', inputs: [] },
  { type: 'error' as const, name: 'InvalidSchema', inputs: [] },
  { type: 'error' as const, name: 'Irrevocable', inputs: [] },
  { type: 'error' as const, name: 'NotFound', inputs: [] },
  { type: 'error' as const, name: 'NotPayable', inputs: [] },
  { type: 'error' as const, name: 'InsufficientValue', inputs: [] },
  { type: 'error' as const, name: 'InvalidLength', inputs: [] },
] as const

const attestedEvent = () =>
  prepareEvent({
    signature:
      'event Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)',
  })

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
const ZERO_BYTES32 = ('0x' + '0'.repeat(64)) as `0x${string}`

export type EasAttestParams = {
  schema: `0x${string}`
  data: {
    recipient?: `0x${string}`
    expirationTime?: bigint
    revocable?: boolean
    refUID: `0x${string}`
    data: `0x${string}`
    value?: bigint
  }
}

/**
 * Prepares a single EAS attest call.
 * Used for Seed and Version attestations in the direct-to-EAS publish path.
 */
export function prepareEasAttest(
  client: ThirdwebClient,
  chain: Chain,
  params: EasAttestParams,
) {
  const { easContractAddress } = getPublishConfig()
  const contract = getContract({
    client,
    chain,
    address: easContractAddress as `0x${string}`,
  })

  return prepareContractCall({
    contract,
    method:
      'function attest((bytes32 schema,(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value) data) request) payable returns (bytes32)' as const,
    params: [
      {
        schema: params.schema,
        data: {
          recipient: (params.data.recipient ?? ZERO_ADDRESS) as `0x${string}`,
          expirationTime: params.data.expirationTime ?? 0n,
          revocable: params.data.revocable ?? true,
          refUID: params.data.refUID,
          data: params.data.data,
          value: params.data.value ?? 0n,
        },
      },
    ],
  })
}

export type MultiAttestationRequest = {
  schema: `0x${string}`
  data: Array<{
    recipient: `0x${string}`
    expirationTime: bigint
    revocable: boolean
    refUID: `0x${string}`
    data: `0x${string}`
    value: bigint
  }>
}

/**
 * Prepares an EAS multiAttest call for batch attestations.
 * Used for property attestations in the direct-to-EAS publish path.
 */
export function prepareEasMultiAttest(
  client: ThirdwebClient,
  chain: Chain,
  requests: MultiAttestationRequest[],
) {
  const { easContractAddress } = getPublishConfig()
  const contract = getContract({
    client,
    chain,
    address: easContractAddress as `0x${string}`,
  })

  return prepareContractCall({
    contract,
    method:
      'function multiAttest((bytes32 schema,(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value)[] data)[] requests) payable returns (bytes32[])' as const,
    params: [requests],
  } as Parameters<typeof prepareContractCall>[0])
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
 * Parses the Attested event from the receipt logs.
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
 * Used after `multiAttest` to persist per-property attestation UIDs to SQLite.
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
      logs: logs as import('viem').Log[],
      events: [attestedEvent()],
      strict: false,
    })
    const out: EasAttestedPair[] = []
    for (const ev of parsed) {
      const uid = ev?.args?.uid as string | undefined
      const schemaUid = ev?.args?.schemaUID as string | undefined
      if (!uid || uid === ZERO_BYTES32) continue
      if (!schemaUid) continue
      out.push({ schemaUid, uid })
    }
    return out
  } catch {
    return []
  }
}

export type MultiRevocationRequest = {
  schema: `0x${string}`
  data: Array<{
    uid: `0x${string}`
    value?: bigint
  }>
}

/**
 * Prepares an EAS multiRevoke call for batch revocation.
 */
export function prepareEasMultiRevoke(
  client: ThirdwebClient,
  chain: Chain,
  requests: MultiRevocationRequest[],
) {
  const { easContractAddress } = getPublishConfig()
  const contract = getContract({
    client,
    chain,
    address: easContractAddress as `0x${string}`,
    abi: [...EAS_ERRORS_ABI],
  })

  return prepareContractCall({
    contract,
    method:
      'function multiRevoke((bytes32 schema,(bytes32 uid,uint256 value)[] data)[] multiRequests) payable' as const,
    params: [
      requests.map((r) => ({
        schema: r.schema,
        data: r.data.map((d) => ({
          uid: d.uid,
          value: d.value ?? 0n,
        })),
      })),
    ],
  } as Parameters<typeof prepareContractCall>[0])
}

export { ZERO_ADDRESS, ZERO_BYTES32 }
