/**
 * Constants for the publish package.
 */
/** EAS Schema Registry on Optimism Sepolia (chain 11155420) */
export const SCHEMA_REGISTRY_ADDRESS =
  '0x4200000000000000000000000000000000000020' as const

/** Schema #1 (Name a Schema) - universal UID for naming attestations */
export const EAS_SCHEMA_NAME_ATTESTATION_UID =
  '0x44d562ac1d7cd77e232978687fea027ace48f719cf1d58c7888e509663bb87fc' as const

/** Thirdweb ManagedAccount factory on Optimism Sepolia (chain 11155420) */
export const THIRDWEB_ACCOUNT_FACTORY_ADDRESS =
  '0x76f47d88bfaf670f5208911181fcdc0e160cb16d' as const

/** EAS contract address on Optimism Sepolia (chain 11155420) */
export const EAS_CONTRACT_ADDRESS =
  '0x4200000000000000000000000000000000000021' as const

export const PublishMachineStates = {
  SUCCESS: 'success',
  FAILURE: 'failure',
} as const

/** States that run for a long time without snapshot changes; need periodic saves. */
export const LONG_RUNNING_PUBLISH_STATES = [
  'pollingForConfirmation',
  'uploadingData',
  'uploadingViaBundler',
] as const

export const PERIODIC_SAVE_INTERVAL_MS = 30_000
