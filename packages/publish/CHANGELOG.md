# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Breaking

- **`waitForPublishReceipt` throws on a reverted transaction** (`PublishTransactionRevertedError`, with `transactionHash` and `receipt`). It used to return the reverted receipt, so callers treated a revert as success. Functions that return its receipt (`attestPublishAuthorization`, `revokePublishAuthorization`, domain ownership and publishedBy attest/revoke) now throw instead.
- **`ensureExecutorModuleInstalled` no longer calls `installModule` on thirdweb ModularCore accounts.** That path could never work: ModularCore installs modules by `delegatecall`, and the Seed executor is an ERC-7579 module without `getModuleConfig`. Accounts without the `SeedExecutorRouterExtension` are skipped, and `assertExecutorModuleReadyForAccount` reports why the executor can't act for them. `ensureExecutorModuleInstalled` now returns `{ status: 'skipped' | 'already-installed' }` or `{ status: 'installed', eas, transactionHash }`. `PublishConfig.modularAccountModuleData` is unused.

### Fixed

- **Sponsored managed-account UserOps running out of gas on large publishes:** thirdweb set `callGasLimit` to the bundler's estimate plus 50k, which tracks gas used, not gas required while the call runs (refunds are credited only at the end, and each nested call holds back 1/64). A large `multiPublish` on OP Sepolia needed about 1.08x that limit and failed with no revert reason. The sponsored managed wallet now sets thirdweb's `overrides.paymaster` hook to raise `callGasLimit` 1.2x (`CALL_GAS_HEADROOM_BPS`) before the paymaster signs, or to use the transaction's own `gas` if that's higher. EntryPoint v0.6 charges only for gas used. Unsponsored managed-account UserOps (`thirdweb.sponsorGas: false`) still use thirdweb's estimate.
- **`seedPaymaster(client, chain, bundlerUrl?)`** is exported from `@seedprotocol/publish/thirdweb` for smart wallets the SDK doesn't build, such as a server's `smartWallet()` with an automation session key: pass it as `overrides.paymaster` when `sponsorGas` is on.
- **Executor install race in `enrollPublishAutomation`:** turning on automation could fail with "The Seed executor is not installed for this ManagedAccount" right after a successful `installSeedExecutor`, because the follow-up `isInitialized` read hit a load-balanced RPC node that hadn't seen the block yet. The install is now confirmed from the receipt's `SeedExecutorInstalled` and `ModuleInitialized` logs, and the readiness check uses the EAS from that event instead of re-reading. When the executor was already installed, the `isInitialized` read is retried briefly. `ensureAutomationSessionKey` retries the `isActiveSigner` read after `addSessionKey` for the same reason.
- **Failed executor installs report why:** an install whose receipt lacks the install events (a reverted transaction, or a sponsored EIP-7702 relayer transaction that succeeded while the inner call reverted) throws `EXECUTOR_MODULE_NOT_INSTALLED` with the decoded revert reason, instead of a misleading "not installed" from the readiness check.
- **List-of-relation EAS names:** a list relation such as `staff` (List → Identity) was attested as `bytes32[] staff` or `bytes32[] staff_identity_ids` depending on whether the model was loaded before the item. `getPublishPayload` and `ensureEasSchemasForItem` now derive the name from the property definition with `listRelationEasPropertyName` (exported from `@seedprotocol/sdk`) and ignore a cached `schemaUid` for list relations. `ensureEasSchemasForItem` refuses to register a list-relation schema that doesn't end in `_ids`. Locally, `createMetadata` writes list-relation rows under the storage name (`staffIdentityIds`), and an `ItemProperty` that receives its schema after construction moves to the storage name while `propertyName` stays `staff`. Already-published data (`author_identity_ids` and the like) is unchanged.
- **Missing property schemas fail publish validation:** when a property's EAS schema can't be found, `getPublishPayload` now reports `publish_schema_not_found` instead of attesting the value under the Version schema. Call `ensureEasSchemasForItem` first, as the publish flow already does.
- **`parseEasRelationPropertyName`** (`@seedprotocol/query`) pluralizes list names with `pluralize`: `staff_identity_ids` → `staff` (was `staffs`). Single relations return the singular (`cover_image_id` → `cover`).
- **Failed UserOps on the permissionless / EIP-7702 sender:** a UserOp that failed inside a successful bundle transaction was returned as a success, so publish went on with no attestations. It now throws with the decoded revert reason.
- **Readable publish failures:** every publish route now simulates `multiPublish` from the sending account before sending, and a call that would revert throws `PUBLISH_PREFLIGHT_FAILED` with the decoded Seed, EAS or `Error(string)` reason (automation keeps `AUTOMATION_PREFLIGHT_FAILED`). Outside automation, a simulation that can't run doesn't block the send. thirdweb's bare `UserOp failed at txHash: 0x…` (usually out of gas) and its undecodable custom-error message are rewritten to say what happened, as `ManagedAccountPublishError` with code `USEROP_FAILED_NO_REASON` (no revert reason; usually out of gas) or `USEROP_REVERTED`, keeping the original as `underlyingCause`. Failed UserOps on the permissionless sender use the same codes.
- **Publish automation on legacy ManagedAccounts:** `enrollPublishAutomation` no longer fails when the account is an ERC-7504 Router (`Router: function does not exist`) instead of ModularCore. Those accounts cannot `installModule`; enroll adds the module-only session key and attests the sidecar. ModularCore accounts still require the executor module to be installed.
- **EAS schema lookup:** `ensureEasSchemasForItem` normalizes property data types (`html` → `Html`) before choosing the on-chain schema, so an existing `bytes32 html` schema is reused instead of registering `string html`. `normalizeDataType` is exported from `@seedprotocol/sdk`.
- **Automation schema registration:** session keys no longer send SchemaRegistry or EAS UserOps when a schema is missing. Publish fails first with `schema "…" is not registered; automation keys can't register schemas`. Register once with the owner wallet via `ensureEasSchemasForItem`.
- **First-time modular publish:** `isAutomationSessionActive` returns `false` when the ManagedAccount has no bytecode instead of throwing `MODULAR_SIGNER_ACTIVATION_FAILED` on viem `0x` / “not a contract”. Interactive first publish can reach `runModularExecutorPublishPrep` / `autoDeployManagedAccount`. Deployed-account RPC or `isActiveSigner` read failures still throw so unattended automation does not fall through to in-app bootstrap.

### Added

- **`readFactorySeedExecutor(factory?)`:** the executor and EAS that a ManagedAccount factory's `SeedExecutorRouterExtension` pins, or `null` when it routes none. Compare it with `modularAccountModuleContract` at startup instead of finding a stale address at the first publish or enroll.
- **`assertExecutorModuleReadyForAccount(address, { installedEas, readAttempts })`:** pass the EAS confirmed from an install receipt to skip the read, or retry a not-initialized read.
- **Publish automation grants:** ManagedAccount-hosted session keys (executor-module-only `approvedTargets`), `seedprotocol.publishAuthorization` sidecar, `enrollPublishAutomation` / `revokePublishAutomation`, and `assertStorageBoundToIdentity`. See `docs/PUBLISH_AUTOMATION.md`.
- **`prepareEasMultiRevoke`:** When `modularAccountModuleContract` is set, routes `multiRevoke` to the executor module so automation session keys can revoke as the ManagedAccount.
- **`resolveRevokeAccount` / `revokeAttestations`:** No longer hard-block ManagedAccount attesters; legacy module-attester path attempts ManagedAccount + executor revoke when configured.
- **Automation `multiPublish` path:** When the provided publish wallet signer is an active session key on the ManagedAccount, `createAttestations` keeps that wallet (no modular in-app bootstrap), routes `multiPublish` to the executor module (`routeToExecutorModule`), and uses read-only **`assertManagedAccountEasMatchesConfig`** (session keys cannot `setEas`).
- Dependency: `@seedprotocol/arweave` (workspace) for SDK-resolution stability when publish loads SDK revoke/sync paths.

### Added (Domain ownership)

- **Domain ownership tooling:** `createDomainOwnershipChallenge`, multi-resolver DNS TXT verify, RDAP snapshot via `rdapper`, `ensureDomainOwnershipSchema` / `attestDomainOwnership` / `revokeDomainOwnership`, `verifyAndAttestDomainOwnership`, and `assessDomainOwnershipLive`. See `docs/DOMAIN_OWNERSHIP.md`.
- Dependency: `@seedprotocol/eas`, `rdapper`.

## 0.5.0

### Breaking

- **Thirdweb is optional.** Core `@seedprotocol/publish` no longer re-exports Thirdweb helpers, `ConnectButton`, or Thirdweb-backed wallet bootstrap APIs. Import them from **`@seedprotocol/publish/thirdweb`**.
- **`PublishConfig.thirdwebClientId`** is optional. When unset, **`rpcUrl`** is required.
- **`SeedSigner`** no longer includes `sendTransaction`. Use **`SeedTxSender`** / **`PublishWallet`** (`{ signer, txSender }`). Wrap Thirdweb Accounts with **`fromThirdwebAccount`** from the `/thirdweb` entry.
- Core **`PublishProvider`** no longer wraps **`ThirdwebProvider`**. Use `@seedprotocol/publish/thirdweb`’s `PublishProvider` for ConnectButton apps.

### Added

- **`SeedTxSender`**, **`PublishWallet`**, **`fromEthersWallet`** (returns `PublishWallet`), **`fromEip1193Provider`**, **`useSeedWallet`**, **`setPublishWallet` / `getPublishWallet`**.
- **`ensureWalletThenPublish`** for vendor-neutral publish entry (registry wallet + optional permissionless EIP-7702).
- **`createPermissionlessTxSender`** (permissionless `to7702SimpleSmartAccount`) with config fields **`bundlerUrl`**, **`paymasterUrl`**, **`accountMode`**, **`chain`**, **`rpcUrl`**.

## 0.4.31

### Fixed

- **First-time modular publish:** Restored automatic session-signer provisioning (`ensureManagedSignerSessionKey`) and unified modular bootstrap (`ensureModularPublishBootstrap`: signer → `setEas` → optional EIP-7702 fallback).
- **First-time non-modular publish:** `createAttestations` now runs `ensureManagedAccountEasConfigured` before `multiPublish` when `useModularExecutor` is false (required since v0.4.23 per-account routing).
- **EIP-7702 bootstrap:** `ensureEip7702ModularAccountReady` polls for on-chain bytecode after `deploySmartAccount` timeout before failing.

### Added

- **`ensureManagedSignerSessionKey`**, **`ensureModularPublishBootstrap`:** Exported helpers for custom publish entrypoints.
- **`MODULAR_SIGNER_ACTIVATION_FAILED`:** New `ManagedAccountPublishError` code when session-key setup fails.

## 0.4.24

### Added

- **`ensureManagedAccountEasConfigured`:** Before modular `multiPublish`, the publish actor ensures the ManagedAccount’s on-chain EAS address (`getEas` / `setEas`) matches resolved config; exported for custom publish flows.

## 0.4.23

### Breaking

- **Attestation routing:** EOAs (publisher `address` has no contract code on Optimism Sepolia) no longer use `multiPublish`. The publish machine sets `attestationStrategy` during `checking` and routes those publishers to **direct EAS** unless `useDirectEas: true` already applied. **`multiPublish`** runs only for **`useModularExecutor`** or when the publisher address is a **deployed** contract (e.g. ManagedAccount).
- **`resolvePublishRouting` (non-modular):** `txTargetAddress` is now the **publisher contract**, never the ABI reference deployment (`MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA` / deprecated `SEED_PROTOCOL_CONTRACT_ADDRESS_OP_SEPOLIA`).
- **`defaultApprovedTargetsForModularPublish`:** The ABI reference address is **removed** from the default allowlist (managed + EAS + optional module only).
- **Modular publish gates:** Removed **`skipModularSignerAuthorizationGates`**, **`ensureActiveSigner`**, **`readModularPublishAuthorizationProbe`**, **`evaluateModularPublishAuthorization`**, **`canPublishAsModularSigner`**, **`ModularSignerPublishAuthorizationError`**, and **`isModularSignerPublishAuthorizationError`**. Modular executor publish no longer checks session-signer state on the managed account. Use **`ensureEip7702ModularAccountReady()`** (called from `createAttestations`) and **`getPublishConfig().autoDeployEip7702ModularAccount`** instead.
- **`ManagedAccountPublishError`:** Removed code **`MODULAR_SIGNER_PROVISIONING_FAILED`**.

### Added

- **`ensureEip7702ModularAccountReady`:** Verifies Optimism Sepolia bytecode at the in-app modular wallet address; optionally runs Thirdweb **`deploySmartAccount`** when **`autoDeployEip7702ModularAccount`** is true (default when **`useModularExecutor`** is on).
- **`autoDeployEip7702ModularAccount`:** Resolved publish config field; explicit **`true`/`false`** wins, otherwise defaults to **`useModularExecutor`**.
- **`Eip7702ModularAccountPublishError`** / **`isEip7702ModularAccountPublishError`:** Typed errors for missing modular wallet or EIP-7702 bootstrap failures.
- **`MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA`:** Canonical name for the `0xcd8c…` deployment the `multiPublish` ABI was generated from. **`SEED_PROTOCOL_CONTRACT_ADDRESS_OP_SEPOLIA`** remains as a deprecated alias.

### Fixed

- **`checking`:** Failures (including RPC errors when verifying contract deployment) surface as **`checkingFailed`** instead of falling through to misleading success paths.

## 0.4.22

### Added

- **`getPublishConfig`:** Public export of the resolved config helper (same defaults and env resolution as internal publish flows). Use it in host apps for modular preflight gating; `usePublishConfig()` alone returns raw `PublishConfig` and does not reflect that resolution.

## 0.4.21

### Fixed

- **Modular executor routing:** `multiPublish` is again sent **to the connected user’s managed account** (`runModularExecutorPublishPrep().managedAddress`), not to the shared reference deployment at `SEED_PROTOCOL_CONTRACT_ADDRESS_OP_SEPOLIA` (`0xcd8c…`). Version 0.4.20 incorrectly used that constant as the modular `getContract` / transaction target for all users, collapsing on-chain identity to one account. Non-modular publish (`useModularExecutor: false`) is unchanged: it still targets that reference address.

### Added

- **`ManagedAccountPublishError`:** `Error.message` now appends a short summary of `underlyingCause` (via `stringifyUnderlyingCause`) so UIs that only display `message` are less likely to show `[object Object]`.
