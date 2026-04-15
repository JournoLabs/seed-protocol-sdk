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

/**
 * Optimism Sepolia address of the deployment the **`multiPublish` Thirdweb ABI** was generated from
 * (`helpers/thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148`).
 *
 * **Do not use as the transaction `to` for user publishes.** Runtime `multiPublish` targets the
 * publisher’s deployed ManagedAccount (non-modular), `managedAddress` (modular), or is not used
 * when attesting via direct EAS (EOA path).
 */
export const MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA =
  '0xcd8c945872df8e664e55cf8885c85ea3ea8f2148' as const

/**
 * @deprecated Misleading name: this is the ABI reference deployment, not a shared on-chain router.
 *   Use {@link MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA}.
 */
export const SEED_PROTOCOL_CONTRACT_ADDRESS_OP_SEPOLIA =
  MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA

export const PublishMachineStates = {
  SUCCESS: 'success',
  FAILURE: 'failure',
} as const

/** States that run for a long time without snapshot changes; need periodic saves. */
export const LONG_RUNNING_PUBLISH_STATES = [
  'pollingForConfirmation',
  'uploadingData',
  'uploadingViaBundler',
  'uploadingViaBundlerPhase2',
] as const

export const PERIODIC_SAVE_INTERVAL_MS = 30_000
