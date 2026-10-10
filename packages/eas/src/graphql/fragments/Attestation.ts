import { graphql, } from '../gql'

// No `schema { schemaNames }`: easscan resolves that join slowly (several times the cost of the
// rest of the query), and the Version and property attestations this fragment is used for are
// never read by schema name. Seed queries that need the name select it themselves.
export const ATTESTATION_FIELDS = graphql(/* GraphQL */ `
  fragment attestationFields on Attestation {
    id
    decodedDataJson
    attester
    refUID
    revoked
    revocationTime
    schemaId
    txid
    timeCreated
    time
    isOffchain
  }
`,)
