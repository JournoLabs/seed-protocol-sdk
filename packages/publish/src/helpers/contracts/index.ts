import {
  encodeFunctionData,
  getAbiItem,
  stringToHex,
  toFunctionSelector,
  toHex,
  zeroAddress,
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
import { accountPermissionsAbi } from '../abi/accountPermissions'
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
  /**
   * The properties this request's new seed uid fills: the contract writes it over the placeholder
   * {@link encodeMultiPublish} puts in each slot. `listElement` names element `elementIndex` of a
   * `bytes32[]` list; without it the whole property is one `bytes32`.
   */
  propertiesToUpdate: Array<{
    publishLocalId: string
    propertySchemaUid: `0x${string}`
    listElement?: boolean
    elementIndex?: number | bigint
  }>
}

type Attestations = MultiPublishRequest['listOfAttestations']

/**
 * The value a slot holds until the contract fills it with request `sourceIndex`'s seed uid
 * (`SeedPublishLib.placeholder`). A seed uid is a hash, so it can't be this small.
 */
const placeholder = (sourceIndex: number): Hex => toHex(BigInt(sourceIndex + 1), { size: 32 })

const byteLength = (data: Hex): number => (data.length - 2) / 2
const wordAt = (data: Hex, offset: number): Hex => `0x${data.slice(2 + offset * 2, 2 + (offset + 32) * 2)}`
const withWordAt = (data: Hex, offset: number, word: Hex): Hex =>
  `0x${data.slice(2, 2 + offset * 2)}${word.slice(2)}${data.slice(2 + (offset + 32) * 2)}`

/** Element count of `data` when it is canonical `abi.encode(bytes32[])`, the only list form the contract fills. */
function canonicalListLength(data: Hex): number | undefined {
  const length = byteLength(data)
  if (length < 64 || (length - 64) % 32 !== 0) return undefined
  if (BigInt(wordAt(data, 0)) !== 32n) return undefined
  const count = BigInt(wordAt(data, 32))
  return count === BigInt((length - 64) / 32) ? Number(count) : undefined
}

/**
 * Resolves each request's `propertiesToUpdate` to `publishIndex`es and returns the requests'
 * attestations with a placeholder in every slot a reference fills. Throws before anything is sent
 * on what `SeedPublishLib.applyReferences` would revert on, naming the request and property, and
 * on a slot still holding the local id of a request in the batch, which no reference fills: the
 * contract would attest the local id's bytes instead of a seed uid.
 */
function prepareReferences(requests: MultiPublishRequest[]) {
  const indexByLocalId = new Map<string, number>()
  requests.forEach((r, i) => {
    if (!r.localId) return
    if (indexByLocalId.has(r.localId)) {
      throw new Error(`multiPublish: duplicate localId "${r.localId}" in the batch`)
    }
    indexByLocalId.set(r.localId, i)
  })
  const attestations: Attestations[] = requests.map((r) =>
    r.listOfAttestations.map((a) => ({ ...a, data: a.data.map((d) => ({ ...d })) })),
  )
  const filled = new Set<string>()

  const references = requests.map((r, sourceIndex) =>
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
      const schema = pu.propertySchemaUid.toLowerCase()
      const listElement = pu.listElement === true
      const elementIndex = BigInt(pu.elementIndex ?? 0)
      const where = `request "${r.localId}" references property ${pu.propertySchemaUid} of "${pu.publishLocalId}"`

      const matches = attestations[publishIndex]!.filter((a) => a.schema.toLowerCase() === schema)
      if (matches.length === 0) throw new Error(`multiPublish: ${where}, which that request doesn't attest`)
      if (matches.length > 1 || matches[0]!.data.length !== 1) {
        throw new Error(`multiPublish: ${where}, which must be attested exactly once to take a reference`)
      }
      const entry = matches[0]!.data[0]!
      let offset = 0
      if (listElement) {
        const count = canonicalListLength(entry.data)
        if (count === undefined) throw new Error(`multiPublish: ${where} as a list element, but it isn't a bytes32[]`)
        if (elementIndex >= BigInt(count)) {
          throw new Error(`multiPublish: ${where} at element ${elementIndex}, past the end of its ${count}-element list`)
        }
        offset = 64 + 32 * Number(elementIndex)
      } else {
        if (elementIndex !== 0n) throw new Error(`multiPublish: ${where} with an element index, but not as a list element`)
        if (byteLength(entry.data) !== 32) throw new Error(`multiPublish: ${where}, which isn't a single bytes32`)
      }
      const slot = `${publishIndex}:${schema}:${offset}`
      if (filled.has(slot)) throw new Error(`multiPublish: ${where}, a slot another reference already fills`)
      filled.add(slot)
      entry.data = withWordAt(entry.data, offset, placeholder(sourceIndex))

      return { publishIndex: BigInt(publishIndex), propertySchemaUid: pu.propertySchemaUid, listElement, elementIndex }
    }),
  )

  const localIdWords = new Map<string, string>()
  for (const localId of indexByLocalId.keys()) {
    if (new TextEncoder().encode(localId).length <= 32) {
      localIdWords.set(stringToHex(localId, { size: 32 }).toLowerCase(), localId)
    }
  }
  attestations.forEach((list, i) => {
    for (const a of list) {
      for (const entry of a.data) {
        const words =
          byteLength(entry.data) === 32
            ? [entry.data]
            : Array.from({ length: canonicalListLength(entry.data) ?? 0 }, (_, k) => wordAt(entry.data, 64 + 32 * k))
        const missed = words.map((w) => localIdWords.get(w.toLowerCase())).find(Boolean)
        if (missed) {
          throw new Error(
            `multiPublish: request "${requests[i]!.localId}" attests the local id of "${missed}" in property ${a.schema}, ` +
              `but no reference fills it with that request's seed uid`,
          )
        }
      }
    }
  })

  return { attestations, references }
}

/**
 * Encode `multiPublish` for the account's SeedProtocolExtension: each `publishLocalId` becomes its
 * index in `requests`, each slot a reference fills holds that reference's placeholder, and the
 * call carries the sum of the attestations' `value`, which the contract requires exactly.
 */
export function encodeMultiPublish(
  to: Address,
  requests: MultiPublishRequest[],
  gas?: bigint,
): SeedTxRequest {
  const { attestations, references } = prepareReferences(requests)
  const value = attestations.flat().reduce((sum, a) => sum + a.data.reduce((n, d) => n + d.value, 0n), 0n)
  return {
    to,
    data: encodeFunctionData({
      abi: multiPublishAbi,
      functionName: 'multiPublish',
      args: [
        requests.map((r, i) => ({
          localId: r.localId,
          seedUid: r.seedUid,
          seedSchemaUid: r.seedSchemaUid,
          versionUid: r.versionUid,
          versionSchemaUid: r.versionSchemaUid,
          seedIsRevocable: r.seedIsRevocable,
          listOfAttestations: attestations[i]!,
          propertiesToUpdate: references[i]!,
        })),
      ],
    }),
    ...(value > 0n && { value }),
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

/**
 * The executor and EAS that accounts from `factory` get from their `SeedExecutorRouterExtension`,
 * or `null` when the factory routes no such extension. For checking `modularAccountModuleContract`
 * at startup instead of at the first publish. `factory` defaults to the configured factory.
 */
export async function readFactorySeedExecutor(
  factory: Address = requireManagedAccountFactoryAddress() as Address,
): Promise<{ executor: Address; eas: Address } | null> {
  const client = getPublishPublicClient()
  const extension = await client.readContract({
    address: factory,
    abi: managedAccountFactoryAbi,
    functionName: 'getImplementationForFunction',
    args: [toFunctionSelector(getAbiItem({ abi: seedExecutorRouterAbi, name: 'getSeedExecutor' }))],
  })
  if (extension === zeroAddress) return null
  // The extension keeps both as immutables, so the implementation reports what accounts see.
  const [executor, eas] = await client.readContract({
    address: extension,
    abi: seedExecutorRouterAbi,
    functionName: 'getSeedExecutor',
  })
  return { executor, eas }
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

/** A ManagedAccount session-key request, as `setPermissionsForSigner` takes it. */
export type SignerPermissionRequest = {
  signer: Address
  /** 0: set a session key's permissions; 1: add an admin; 2: remove one. */
  isAdmin: number
  approvedTargets: readonly Address[]
  nativeTokenLimitPerTransaction: bigint
  permissionStartTimestamp: bigint
  permissionEndTimestamp: bigint
  reqValidityStartTimestamp: bigint
  reqValidityEndTimestamp: bigint
  uid: Hex
}

export type SignerPermissions = {
  approvedTargets: readonly Address[]
  nativeTokenLimitPerTransaction: bigint
  startTimestamp: bigint
  endTimestamp: bigint
}

/** `setPermissionsForSigner(req, signature)` on `account`. Anyone may send it. */
export function encodeSetPermissionsForSigner(
  account: Address,
  req: SignerPermissionRequest,
  signature: Hex,
): SeedTxRequest {
  return {
    to: account,
    data: encodeFunctionData({
      abi: accountPermissionsAbi,
      functionName: 'setPermissionsForSigner',
      args: [req, signature],
    }),
  }
}

export async function readPermissionsForSigner(
  account: Address,
  signer: Address,
): Promise<SignerPermissions> {
  return getPublishPublicClient().readContract({
    address: account,
    abi: accountPermissionsAbi,
    functionName: 'getPermissionsForSigner',
    args: [signer],
  })
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
