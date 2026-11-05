/**
 * Constants for the publish package.
 */
/** Schema #1 (Name a Schema) - universal UID for naming attestations */
export const EAS_SCHEMA_NAME_ATTESTATION_UID =
  '0x44d562ac1d7cd77e232978687fea027ace48f719cf1d58c7888e509663bb87fc' as const

/**
 * Thirdweb ManagedAccount factories Seed Protocol has deployed, keyed by chain id.
 * Chains not listed here need `PublishConfig.managedAccountFactoryAddress` for managed / modular flows.
 */
export const MANAGED_ACCOUNT_FACTORY_ADDRESSES: Readonly<Record<number, `0x${string}`>> = {
  11155420: '0x76f47d88bfaf670f5208911181fcdc0e160cb16d',
}

/**
 * @deprecated OP Stack predeploy; wrong on non-OP chains. Use `getPublishConfig().easContractAddress`.
 */
export const EAS_CONTRACT_ADDRESS =
  '0x4200000000000000000000000000000000000021' as const

/**
 * Optimism Sepolia ManagedAccount used as the reference deployment for the **`multiPublish` ABI**.
 * It is an EIP-1167 clone of the ManagedAccount implementation `0x3ae2…688f`, whose own dispatcher
 * has no `multiPublish`. The account routes selector 0xa1263421 to the extension at `0x851c…4437`
 * (`getImplementationForFunction`), which the factory in `MANAGED_ACCOUNT_FACTORY_ADDRESSES`
 * registers and whose code has the selector (OP Sepolia RPC, 2026-11-05).
 *
 * **Do not use as the transaction `to` for user publishes.** Runtime `multiPublish` targets the
 * publisher’s deployed ManagedAccount (non-modular), `managedAddress` (modular), or is not used
 * when attesting via direct EAS (EOA path).
 *
 * @internal Exported for the package's own tests and tooling; not part of the public API.
 */
export const MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA =
  '0xcd8c945872df8e664e55cf8885c85ea3ea8f2148' as const

export const PublishMachineStates = {
  SUCCESS: 'success',
  FAILURE: 'failure',
} as const

/** States that run for a long time without snapshot changes; need periodic saves. */
export const LONG_RUNNING_PUBLISH_STATES = [
  'uploadingViaBundler',
  'uploadingViaBundlerPhase2',
] as const

export const PERIODIC_SAVE_INTERVAL_MS = 30_000
