import { size, type Hex } from 'viem'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'

/** Default {@link PublishConfig.maxPublishGas}: below the 16.7M per-transaction cap of EIP-7825. */
export const PUBLISH_MAX_GAS = 16_000_000n
/** Below the 131,072 bytes nodes accept in a transaction, leaving room for a UserOp's wrapping. */
export const PUBLISH_MAX_CALLDATA_BYTES = 120_000

/** What EAS pays to store one byte of attestation data, and to create a seed with its version. */
const GAS_PER_ATTESTED_BYTE = 710n
const GAS_PER_NEW_PAIR = 350_000n

const ZERO_UID = `0x${'0'.repeat(64)}`

type SizedRequest = {
  localId?: string
  seedUid?: string
  listOfAttestations?: Array<{ data?: Array<{ data?: string }> }>
}

export function maxPublishGas(): bigint {
  return getPublishConfig().maxPublishGas ?? PUBLISH_MAX_GAS
}

function attestedBytes(request: SizedRequest): number {
  let bytes = 0
  for (const attestation of request.listOfAttestations ?? []) {
    for (const entry of attestation.data ?? []) bytes += size((entry.data ?? '0x') as Hex)
  }
  return bytes
}

/**
 * The least gas `requests` can cost when sent in one transaction. It leaves out the base cost of
 * each attestation, so a publish over it is over for certain and needs no RPC call to say so.
 * `newPairs: false` is for a transaction that attests properties only.
 */
export function localPublishGas(requests: readonly SizedRequest[], options?: { newPairs?: boolean }): bigint {
  let gas = 0n
  for (const request of requests) {
    gas += BigInt(attestedBytes(request)) * GAS_PER_ATTESTED_BYTE
    const createsSeed = !request.seedUid || request.seedUid === ZERO_UID
    if (createsSeed && options?.newPairs !== false) gas += GAS_PER_NEW_PAIR
  }
  return gas
}

function largestRequests(requests: readonly SizedRequest[]): string {
  return requests
    .map((request, index) => ({ name: request.localId ?? `request ${index}`, bytes: attestedBytes(request) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 3)
    .map(({ name, bytes }) => `${name} (${bytes} bytes)`)
    .join(', ')
}

/**
 * Refuses a publish too large for one transaction, with no RPC call. Run it before the simulation:
 * a node may reject oversized calldata with an error that names nothing.
 *
 * @throws ManagedAccountPublishError `PUBLISH_TOO_LARGE`
 */
export function assertPublishFits(
  from: string,
  requests: readonly SizedRequest[],
  options?: { calldata?: Hex; newPairs?: boolean },
): void {
  const refuse = (reason: string) =>
    new ManagedAccountPublishError(
      `This publish ${reason}; nothing was sent. Largest: ${largestRequests(requests)}. ` +
        'Publish some of its related drafts on their own first.',
      'PUBLISH_TOO_LARGE',
      from,
    )
  const calldataBytes = options?.calldata ? size(options.calldata) : 0
  if (calldataBytes > PUBLISH_MAX_CALLDATA_BYTES) {
    throw refuse(`is ${calldataBytes} bytes of calldata, over the limit of ${PUBLISH_MAX_CALLDATA_BYTES}`)
  }
  const gas = localPublishGas(requests, options)
  const limit = maxPublishGas()
  if (gas > limit) throw refuse(`needs at least ${gas} gas, over the limit of ${limit}`)
}
