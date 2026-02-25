import { getContract, prepareContractCall } from 'thirdweb'
import type { ThirdwebClient } from 'thirdweb'
import type { Chain } from 'thirdweb/chains'
import { SchemaEncoder, NO_EXPIRATION, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import { getPublishConfig } from '~/config'
import { EAS_SCHEMA_NAME_ATTESTATION_UID } from '~/helpers/constants'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

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

  const { easContractAddress } = getPublishConfig()
  const contract = getContract({
    client,
    chain,
    address: easContractAddress as `0x${string}`,
    // No ABI - use string method so thirdweb parses the exact signature
  })

  return prepareContractCall({
    contract,
    method:
      'function attest((bytes32 schema,(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value) data) request) payable returns (bytes32)' as const,
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
