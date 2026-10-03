import {
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem'
import {
  multiPublishAbi,
  publisherReadWriteAbi,
} from '../abi/publisher'
import { managedAccountFactoryAbi } from '../abi/factory'
import { executorModuleAbi } from '../abi/executor'
import { MODULE_TYPE_EXECUTOR, seedExecutorRouterAbi } from '../abi/seedExecutorRouter'
import { easAbi } from '../abi/eas'
import { schemaRegistryAbi } from '../abi/schemaRegistry'
import type { SeedTxRequest } from '../seedSigner'
import { getPublishPublicClient } from '../chainClient'
import { getPublishConfig, requireManagedAccountFactoryAddress } from '../../config'

export type MultiPublishRequest = {
  localId: string
  seedUid: `0x${string}`
  seedSchemaUid: `0x${string}`
  versionUid: `0x${string}`
  versionSchemaUid: `0x${string}`
  seedIsRevocable: boolean
  listOfAttestations: Array<{
    schema: `0x${string}`
    data: Array<{
      recipient: `0x${string}`
      expirationTime: bigint
      revocable: boolean
      refUID: `0x${string}`
      data: `0x${string}`
      value: bigint
    }>
  }>
  propertiesToUpdate: Array<{
    publishLocalId: string
    propertySchemaUid: `0x${string}`
  }>
}

/**
 * Resolves a request's `propertiesToUpdate` to `publishIndex`es: the position in `requests` of the
 * request whose `localId` each one names. Throws rather than guess, since the contract can't tell
 * when an index lands on the wrong request: on a duplicate `localId`, or a `publishLocalId` that is
 * missing, empty or not in `requests`.
 */
function publishIndexResolver(requests: MultiPublishRequest[]) {
  const indexByLocalId = new Map<string, bigint>()
  requests.forEach((r, i) => {
    if (!r.localId) return
    if (indexByLocalId.has(r.localId)) {
      throw new Error(`multiPublish: duplicate localId "${r.localId}" in the batch`)
    }
    indexByLocalId.set(r.localId, BigInt(i))
  })
  return (r: MultiPublishRequest) =>
    (r.propertiesToUpdate ?? []).map((pu) => {
      if (!pu.publishLocalId) {
        throw new Error(`multiPublish: request "${r.localId}" has a cross-reference with no publishLocalId`)
      }
      const publishIndex = indexByLocalId.get(pu.publishLocalId)
      if (publishIndex === undefined) {
        throw new Error(
          `multiPublish: request "${r.localId}" cross-references localId "${pu.publishLocalId}", which isn't in the batch`,
        )
      }
      return { publishIndex, propertySchemaUid: pu.propertySchemaUid }
    })
}

/**
 * Encode `multiPublish` for the account's SeedProtocolExtension, mapping each `publishLocalId` to
 * its index in `requests`.
 */
export function encodeMultiPublish(
  to: Address,
  requests: MultiPublishRequest[],
  gas?: bigint,
): SeedTxRequest {
  const publishIndexes = publishIndexResolver(requests)
  return {
    to,
    data: encodeFunctionData({
      abi: multiPublishAbi,
      functionName: 'multiPublish',
      args: [
        requests.map((r) => ({
          localId: r.localId,
          seedUid: r.seedUid,
          seedSchemaUid: r.seedSchemaUid,
          versionUid: r.versionUid,
          versionSchemaUid: r.versionSchemaUid,
          seedIsRevocable: r.seedIsRevocable,
          listOfAttestations: r.listOfAttestations,
          propertiesToUpdate: publishIndexes(r),
        })),
      ],
    }),
    gas,
  }
}

/**
 * Encode `multiPublish` for the SeedProtocolExecutor module, which takes the same request struct
 * as the extension: only the target differs from {@link encodeMultiPublish}.
 */
export function encodeExecutorMultiPublish(
  to: Address,
  requests: MultiPublishRequest[],
  gas?: bigint,
): SeedTxRequest {
  return encodeMultiPublish(to, requests, gas)
}

export async function readExecutorModuleIsInitialized(
  moduleAddress: Address,
  account: Address,
): Promise<boolean> {
  return getPublishPublicClient().readContract({
    address: moduleAddress,
    abi: executorModuleAbi,
    functionName: 'isInitialized',
    args: [account],
  })
}

export async function readExecutorModuleEas(
  moduleAddress: Address,
  account: Address,
): Promise<Address> {
  return getPublishPublicClient().readContract({
    address: moduleAddress,
    abi: executorModuleAbi,
    functionName: 'getEAS',
    args: [account],
  })
}

/**
 * The executor and EAS pinned by the account's `SeedExecutorRouterExtension`, or `null` when the
 * account has no such extension (pre-rollout Router accounts, ModularCore accounts).
 */
export async function readSeedExecutorRouter(
  account: Address,
): Promise<{ executor: Address; eas: Address } | null> {
  try {
    const [executor, eas] = await getPublishPublicClient().readContract({
      address: account,
      abi: seedExecutorRouterAbi,
      functionName: 'getSeedExecutor',
    })
    return { executor, eas }
  } catch {
    return null
  }
}

/** Whether the router extension reports `executor` installed on `account`. */
export async function readSeedExecutorInstalled(account: Address, executor: Address): Promise<boolean> {
  return getPublishPublicClient().readContract({
    address: account,
    abi: seedExecutorRouterAbi,
    functionName: 'isModuleInstalled',
    args: [MODULE_TYPE_EXECUTOR, executor, '0x'],
  })
}

/**
 * `installSeedExecutor()` on `account`. Admin-only: send it from the account's admin EOA
 * directly; a self-call via `execute` (what smart-account wallets send) is rejected.
 */
export function encodeInstallSeedExecutor(account: Address): SeedTxRequest {
  return {
    to: account,
    data: encodeFunctionData({ abi: seedExecutorRouterAbi, functionName: 'installSeedExecutor' }),
  }
}

export function encodeSetEas(to: Address, eas: Address): SeedTxRequest {
  return {
    to,
    data: encodeFunctionData({
      abi: publisherReadWriteAbi,
      functionName: 'setEas',
      args: [eas],
    }),
  }
}

export async function readGetEas(managedAddress: Address): Promise<Address> {
  return getPublishPublicClient().readContract({
    address: managedAddress,
    abi: publisherReadWriteAbi,
    functionName: 'getEas',
  })
}

export async function readIsActiveSigner(
  managedAddress: Address,
  signer: Address,
): Promise<boolean> {
  return getPublishPublicClient().readContract({
    address: managedAddress,
    abi: publisherReadWriteAbi,
    functionName: 'isActiveSigner',
    args: [signer],
  })
}

export async function readIsAdmin(managedAddress: Address, signer: Address): Promise<boolean> {
  return getPublishPublicClient().readContract({
    address: managedAddress,
    abi: publisherReadWriteAbi,
    functionName: 'isAdmin',
    args: [signer],
  })
}

export async function readFactoryGetAddress(
  adminSigner: Address,
  data: Hex = '0x',
): Promise<Address> {
  return getPublishPublicClient().readContract({
    address: requireManagedAccountFactoryAddress() as Address,
    abi: managedAccountFactoryAbi,
    functionName: 'getAddress',
    args: [adminSigner, data],
  })
}

export function encodeCreateAccount(
  admin: Address,
  data: Hex = '0x',
): SeedTxRequest {
  return {
    to: requireManagedAccountFactoryAddress() as Address,
    data: encodeFunctionData({
      abi: managedAccountFactoryAbi,
      functionName: 'createAccount',
      args: [admin, data],
    }),
  }
}

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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export function encodeEasAttest(params: EasAttestParams): SeedTxRequest {
  const { easContractAddress } = getPublishConfig()
  return {
    to: easContractAddress as Address,
    data: encodeFunctionData({
      abi: easAbi,
      functionName: 'attest',
      args: [
        {
          schema: params.schema,
          data: {
            recipient: (params.data.recipient ?? ZERO_ADDRESS) as Address,
            expirationTime: params.data.expirationTime ?? 0n,
            revocable: params.data.revocable ?? true,
            refUID: params.data.refUID,
            data: params.data.data,
            value: params.data.value ?? 0n,
          },
        },
      ],
    }),
  }
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

export function encodeEasMultiAttest(requests: MultiAttestationRequest[]): SeedTxRequest {
  const { easContractAddress } = getPublishConfig()
  return {
    to: easContractAddress as Address,
    data: encodeFunctionData({
      abi: easAbi,
      functionName: 'multiAttest',
      args: [requests],
    }),
  }
}

export type MultiRevocationRequest = {
  schema: `0x${string}`
  data: Array<{
    uid: `0x${string}`
    value?: bigint
  }>
}

export function encodeEasMultiRevoke(requests: MultiRevocationRequest[]): SeedTxRequest {
  const { easContractAddress } = getPublishConfig()
  return {
    to: easContractAddress as Address,
    data: encodeFunctionData({
      abi: easAbi,
      functionName: 'multiRevoke',
      args: [
        requests.map((r) => ({
          schema: r.schema,
          data: r.data.map((d) => ({
            uid: d.uid,
            value: d.value ?? 0n,
          })),
        })),
      ],
    }),
  }
}

export type SchemaRecord = {
  uid: string
  resolver: string
  revocable: boolean
  schema: string
}

const ZERO_BYTES32 = '0x' + '0'.repeat(64)

export async function readSchemaRecord(uid: string): Promise<SchemaRecord | null> {
  const result = await getPublishPublicClient().readContract({
    address: getPublishConfig().schemaRegistryAddress as Address,
    abi: schemaRegistryAbi,
    functionName: 'getSchema',
    args: [uid as Hex],
  })
  if (!result || result.uid === ZERO_BYTES32) return null
  return {
    uid: result.uid,
    resolver: result.resolver,
    revocable: result.revocable,
    schema: result.schema,
  }
}

export function encodeRegisterSchema(params: {
  schema: string
  resolverAddress: string
  revocable: boolean
}): SeedTxRequest {
  return {
    to: getPublishConfig().schemaRegistryAddress as Address,
    data: encodeFunctionData({
      abi: schemaRegistryAbi,
      functionName: 'register',
      args: [params.schema, params.resolverAddress as Address, params.revocable],
    }),
  }
}
