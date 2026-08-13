import {
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem'
import {
  multiPublishAbi,
  multiPublishIntegerAbi,
  publisherReadWriteAbi,
} from '../abi/publisher'
import { managedAccountFactoryAbi } from '../abi/factory'
import { easAbi } from '../abi/eas'
import { schemaRegistryAbi } from '../abi/schemaRegistry'
import type { SeedTxRequest } from '../seedSigner'
import { getPublishPublicClient } from '../chainClient'
import {
  SCHEMA_REGISTRY_ADDRESS,
  THIRDWEB_ACCOUNT_FACTORY_ADDRESS,
} from '../constants'
import { getPublishConfig } from '../../config'

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

export type MultiPublishIntegerRequest = {
  localIdIndex: bigint
  seedUid: `0x${string}`
  seedSchemaUid: `0x${string}`
  versionUid: `0x${string}`
  versionSchemaUid: `0x${string}`
  seedIsRevocable: boolean
  listOfAttestations: MultiPublishRequest['listOfAttestations']
  propertiesToUpdate: Array<{
    publishLocalIdIndex: bigint
    propertySchemaUid: `0x${string}`
  }>
}

export function encodeMultiPublish(
  to: Address,
  requests: MultiPublishRequest[],
  gas?: bigint,
): SeedTxRequest {
  return {
    to,
    data: encodeFunctionData({
      abi: multiPublishAbi,
      functionName: 'multiPublish',
      args: [requests],
    }),
    gas,
  }
}

export function encodeMultiPublishInteger(
  to: Address,
  requests: MultiPublishIntegerRequest[],
  gas?: bigint,
): SeedTxRequest {
  return {
    to,
    data: encodeFunctionData({
      abi: multiPublishIntegerAbi,
      functionName: 'multiPublish',
      args: [requests],
    }),
    gas,
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

export async function readFactoryGetAddress(
  adminSigner: Address,
  data: Hex = '0x',
): Promise<Address> {
  const { thirdwebAccountFactoryAddress } = getPublishConfig()
  return getPublishPublicClient().readContract({
    address: (thirdwebAccountFactoryAddress ||
      THIRDWEB_ACCOUNT_FACTORY_ADDRESS) as Address,
    abi: managedAccountFactoryAbi,
    functionName: 'getAddress',
    args: [adminSigner, data],
  })
}

export function encodeCreateAccount(
  admin: Address,
  data: Hex = '0x',
): SeedTxRequest {
  const { thirdwebAccountFactoryAddress } = getPublishConfig()
  return {
    to: (thirdwebAccountFactoryAddress ||
      THIRDWEB_ACCOUNT_FACTORY_ADDRESS) as Address,
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
    address: SCHEMA_REGISTRY_ADDRESS as Address,
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
    to: SCHEMA_REGISTRY_ADDRESS as Address,
    data: encodeFunctionData({
      abi: schemaRegistryAbi,
      functionName: 'register',
      args: [params.schema, params.resolverAddress as Address, params.revocable],
    }),
  }
}
