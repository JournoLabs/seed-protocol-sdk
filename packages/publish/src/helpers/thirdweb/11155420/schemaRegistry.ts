import { getContract, prepareContractCall, readContract } from 'thirdweb'
import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { SCHEMA_REGISTRY_ADDRESS } from '~/helpers/constants'

const SCHEMA_REGISTRY_ABI = [
  {
    inputs: [{ internalType: 'bytes32', name: 'uid', type: 'bytes32' }],
    name: 'getSchema',
    outputs: [
      {
        components: [
          { internalType: 'bytes32', name: 'uid', type: 'bytes32' },
          { internalType: 'contract ISchemaResolver', name: 'resolver', type: 'address' },
          { internalType: 'bool', name: 'revocable', type: 'bool' },
          { internalType: 'string', name: 'schema', type: 'string' },
        ],
        internalType: 'struct SchemaRecord',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'string', name: 'schema', type: 'string' },
      { internalType: 'contract ISchemaResolver', name: 'resolver', type: 'address' },
      { internalType: 'bool', name: 'revocable', type: 'bool' },
    ],
    name: 'register',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

export type SchemaRecord = {
  uid: string
  resolver: string
  revocable: boolean
  schema: string
}

const ZERO_BYTES32 = '0x' + '0'.repeat(64)

export function getSchemaRegistryContract(client: ThirdwebClient, chain: Chain) {
  return getContract({
    client,
    chain,
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
  })
}

export async function getSchemaRecord(
  client: ThirdwebClient,
  chain: Chain,
  uid: string,
): Promise<SchemaRecord | null> {
  const contract = getSchemaRegistryContract(client, chain)
  const result = await readContract({
    contract,
    method: 'getSchema',
    params: [uid as `0x${string}`],
  })
  if (!result || (result as SchemaRecord).uid === ZERO_BYTES32) {
    return null
  }
  return result as SchemaRecord
}

export type RegisterSchemaParams = {
  schema: string
  resolverAddress: string
  revocable: boolean
}

export function registerSchema(
  client: ThirdwebClient,
  chain: Chain,
  params: RegisterSchemaParams,
) {
  const contract = getSchemaRegistryContract(client, chain)
  return prepareContractCall({
    contract,
    method: 'register',
    params: [params.schema, params.resolverAddress as `0x${string}`, params.revocable],
  })
}
