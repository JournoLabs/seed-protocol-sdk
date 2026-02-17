/**
 * Constants for the publish package.
 * Env vars (VITE_*) are read at build/runtime for Vite apps.
 */
const _importMeta = typeof import.meta !== 'undefined' ? import.meta : undefined

export const UPLOAD_API_BASE_URL: string =
  (_importMeta?.env?.VITE_UPLOAD_API_BASE_URL as string) ?? ''

export const EAS_CONTRACT_ADDRESS: string =
  (_importMeta?.env?.VITE_EAS_CONTRACT_ADDRESS as string) ?? ''

/** EAS Schema Registry on Optimism Sepolia (chain 11155420) */
export const SCHEMA_REGISTRY_ADDRESS =
  '0x2155BA33158DDD42da3d56EfBC4d60EFFBF0882B' as const

/** Schema #1 (Name a Schema) - universal UID for naming attestations */
export const EAS_SCHEMA_NAME_ATTESTATION_UID =
  '0x44d562ac1d7cd77e232978687fea027ace48f719cf1d58c7888e509663bb87fc' as const

export const PublishMachineStates = {
  SUCCESS: 'success',
  FAILURE: 'failure',
} as const
