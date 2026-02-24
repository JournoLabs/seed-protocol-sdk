import { getContract, prepareContractCall, prepareEvent, parseEventLogs } from 'thirdweb'
import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { encodeAbiParameters } from 'viem'
import { getPublishConfig } from '~/config'

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
  if (!receipt.logs?.length) return undefined
  const want = easContractAddress.toLowerCase()
  const logs = receipt.logs.filter((l) => l.address && l.address.toLowerCase() === want)
  if (!logs.length) return undefined
  try {
    const parsed = parseEventLogs({
      logs: logs as import('viem').Log[],
      events: [attestedEvent()],
      strict: false,
    })
    const first = parsed[0]
    const uid = first?.args?.uid as string | undefined
    if (uid && uid !== ZERO_BYTES32) return uid
  } catch {
    // ignore
  }
  return undefined
}

export { ZERO_ADDRESS, ZERO_BYTES32 }
