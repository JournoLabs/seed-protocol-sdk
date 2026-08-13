import { SchemaEncoder, NO_EXPIRATION, ZERO_BYTES32 } from '@ethereum-attestation-service/eas-sdk'
import { EAS_SCHEMA_NAME_ATTESTATION_UID } from './constants'
import { encodeEasAttest } from './contracts'
import type { SeedTxRequest } from './seedSigner'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export type NameSchemaAttestationParams = {
  schemaUid: string
  schemaName: string
}

export function prepareNameSchemaAttestation(
  params: NameSchemaAttestationParams,
): SeedTxRequest {
  const schemaEncoder = new SchemaEncoder('bytes32 schemaId,string name')
  const encodedData = schemaEncoder.encodeData([
    { name: 'schemaId', value: params.schemaUid as `0x${string}`, type: 'bytes32' },
    { name: 'name', value: params.schemaName, type: 'string' },
  ])

  return encodeEasAttest({
    schema: EAS_SCHEMA_NAME_ATTESTATION_UID as `0x${string}`,
    data: {
      recipient: ZERO_ADDRESS as `0x${string}`,
      expirationTime: BigInt(NO_EXPIRATION),
      revocable: true,
      refUID: ZERO_BYTES32 as `0x${string}`,
      data: encodedData as `0x${string}`,
      value: 0n,
    },
  })
}
