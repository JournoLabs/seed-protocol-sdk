import { graphql, } from '../gql'

export const ATTESTATION_FIELDS = graphql(/* GraphQL */ `
  fragment attestationFields on Attestation {
    id
    decodedDataJson
    attester
    schema {
      schemaNames {
        name
      }
    }
    refUID
    revoked
    schemaId
    txid
    timeCreated
    time
    isOffchain
  }
`,)
