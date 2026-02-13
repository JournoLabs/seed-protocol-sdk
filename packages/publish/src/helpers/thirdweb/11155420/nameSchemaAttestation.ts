import { getContract, prepareContractCall } from 'thirdweb'
import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { SchemaEncoder, NO_EXPIRATION, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import { EAS_CONTRACT_ADDRESS, EAS_SCHEMA_NAME_ATTESTATION_UID } from '~/helpers/constants'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const EAS_ATTEST_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes32', name: 'schema', type: 'bytes32' },
          {
            components: [
              { internalType: 'address', name: 'recipient', type: 'address' },
              { internalType: 'uint64', name: 'expirationTime', type: 'uint64' },
              { internalType: 'bool', name: 'revocable', type: 'bool' },
              { internalType: 'bytes32', name: 'refUID', type: 'bytes32' },
              { internalType: 'bytes', name: 'data', type: 'bytes' },
              { internalType: 'uint256', name: 'value', type: 'uint256' },
            ],
            internalType: 'struct AttestationRequestData',
            name: 'data',
            type: 'tuple',
          },
        ],
        internalType: 'struct AttestationRequest',
        name: 'request',
        type: 'tuple',
      },
    ],
    name: 'attest',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

export type NameSchemaAttestationParams = {
  schemaUid: string
  schemaName: string
}

export function prepareNameSchemaAttestation(
  client: ThirdwebClient,
  chain: Chain,
  params: NameSchemaAttestationParams,
) {
  const schemaEncoder = new SchemaEncoder('bytes32 schemaId,string name')
  const encodedData = schemaEncoder.encodeData([
    { name: 'schemaId', value: params.schemaUid as `0x${string}`, type: 'bytes32' },
    { name: 'name', value: params.schemaName, type: 'string' },
  ])

  const contract = getContract({
    client,
    chain,
    address: EAS_CONTRACT_ADDRESS as `0x${string}`,
    abi: EAS_ATTEST_ABI,
  })

  return prepareContractCall({
    contract,
    method: 'function attest((bytes32 schema,(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value) data) request) payable returns (bytes32)',
    params: [
      {
        schema: EAS_SCHEMA_NAME_ATTESTATION_UID as `0x${string}`,
        data: {
          recipient: ZERO_ADDRESS as `0x${string}`,
          expirationTime: BigInt(NO_EXPIRATION),
          revocable: true,
          refUID: ZERO_BYTES32 as `0x${string}`,
          data: encodedData as `0x${string}`,
          value: 0n,
        },
      },
    ],
  })
}
