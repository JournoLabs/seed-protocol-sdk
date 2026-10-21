# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Publish revokes the attestations of retracted properties (`property.clear({ retract: true })`, ADR 0021) in a new `revokingRetractedProperties` state after the attestations, from the seed's attester. An EOA publisher signs a second transaction. A failed revocation leaves the publish in `retractionFailureRecoverable`, where `retry` sends it again; the next Publish also sends whatever is still live. `checking` fails before anything is attested when the wallet can't revoke (an automation session key, or a seed attested by the executor module).
- `item.unpublish()` revokes the seed attestation before its versions and properties. A sync that runs between the batches then sees the seed revoked and keeps the item's last values, instead of storing its revoked properties as retracted.

### Breaking

- **Publish only uploads data items.** The L1 path (an Arweave transaction the upload API reimbursed from its own wallet, then confirmed and uploaded in chunks) is removed, so the upload server can drop its reimbursement route. Files go to `${uploadApiBaseUrl}/api/upload/arweave/batch` as signed data items, or to Turbo with `payment: { storage: 'user' }`.
- `useArweaveBundler` is deprecated. `true` changes nothing; `false` makes `initPublish` throw `PublishPaymentConfigError`. Apps that left it unset now upload data items and need `signDataItems` or a `dataItemSigner` (at `createPublish` or in the config).
- Removed: the `signArweaveTransactions` and `arweaveJwk` options (config and `createPublish`), the `SerializedPublishUpload` and `ArweaveTransactionInfoResult` types, and the context fields `reimbursementTransactionId`, `reimbursementConfirmed`, `requestResponse`, `transactionKeys`, `uploaderState` and `currentTransactionIndex`.
- `resolvePublishPayment(...).storage.path` and a cost estimate's `arweave.path` are always `'bundler'`. `chargedUploadBytes(work, uploadTo)` drops its `path` argument; `combinePublishCostEstimate` still accepts `arweavePath: 'bundler'`.
- A publish saved mid-way through the L1 path (`creatingArweaveTransactions`, `sendingReimbursementRequest`, `pollingForConfirmation`, `uploadingData` or their `Phase2` states) is marked interrupted on restore instead of resuming; publish the item again.
- The L1-finalize worker no longer restores data item ids that publish 0.7.4 and earlier overwrote with L1 ids. Databases that old are recreated by `@seedprotocol/sdk` (minimum upgrade-from version 0.7.7).

## 0.7.7 (2026-10-18)

### Commits

#### Fixes

- direct-to-EAS refuses an update aimed at an earlier request (6f06bc28)
- sdk: record published list/relation values as the attested seed uids (076a6927)

## 0.7.6 (2026-10-17)

- Bundler and Turbo uploads no longer use the `Buffer` global, so publishing from a browser works without Node polyfills.

### Commits

#### Fixes

- retry attestation verification while the indexer lags (e6f641f3)
- upload data items without the Buffer global (ca361c32)

## 0.7.5 (2026-10-17)

### Breaking

- **Number properties register `string <name>` EAS schemas instead of `uint8 <name>`** (ADR 0010, through `@seedprotocol/sdk`'s data types). The first publish of a Number property after upgrading registers its new schema.
- **Direct EAS needs a wallet that says it is an EOA.** Without `useDirectEas`, a publisher with no contract attests straight to EAS only when its `PublishWallet` has `kind: 'eoa'` and signs as the publisher. `fromEip1193Provider` and `fromEthersWallet` set `kind: 'eoa'`; `fromThirdwebAccount(account, { kind })` takes it, and `ConnectButton` and the managed-account helpers set it. A wallet without a kind uses its registered session's kind when the signer is the same, and is refused otherwise. To migrate a hand-built wallet, set `kind`, or set `useDirectEas` to attest directly anyway. (Before, admins were guessed through factory reads, which let an undeployed thirdweb smart wallet through.)
- **`initPublish` requires `uploadApiBaseUrl`** when the operator pays for storage (the default), and checks that it is an http(s) URL or a path from the page's origin.
- **`PublishManager.query(seedLocalId)` only reads.** It returns the publish's current snapshot. It used to stop the publish.
- **`ensureWalletThenPublish` / `ensureSmartWalletThenPublish`** wait for the publish to spawn (not to finish). `'started'` carries the actor as `publish`; a new `'already_publishing'` outcome means nothing started. `started` is deprecated and already resolved.

### Changed

- `useCanPublishItem` is `false` until its check finishes, and checks again when owned addresses change.
- `ConnectButton` stops running publishes only when another wallet takes over, not on every wallet sync.
- `pollForConfirmation` fails after 30 min, or after 12 failed status requests in a row.
- Cost estimates: an Arweave L1 upload is charged for at least 256 KiB, a bundle once, and Turbo uploads up to 100 KiB are free (`arweave.chargedBytes`). Gas on a testnet is priced at $0 (`evm.testnet`).
- Deprecated: `useLocalWalletAccount` (always `null`), and the `gatewayTransport` and `modularAccountModuleData` config fields (not read).
- **A new user's smart wallet is deployed on its first publish.** With the default `ConnectButton` (no `useModularExecutor`), an undeployed account used to be refused with `MANAGED_ACCOUNT_NOT_DEPLOYED`. `PublishWalletSession.deploy` deploys it; `ConnectButton` sets it.
- **Data items are signed by an EOA.** `PublishWalletSession.dataItemSigner` holds the key that signs Arweave data items; `ConnectButton` sets it to a smart wallet's admin EOA, and the publish helpers no longer default to a smart account's signer, whose signatures don't verify as data items. Data-item signing checks the signer's key is its address.
- **A bundler or Turbo publish restored after a reload no longer skips its upload.** Its signed data items aren't saved, so it can't resume mid-upload: restore marks it interrupted, to publish again. `uploadViaBundler` fails with `MissingSignedDataItemsError` instead of reporting an upload it didn't do.
- **Local storage ids stay the attested data item ids.** The L1-finalize worker no longer replaces them with the bundle's L1 id; ids it replaced are set back where the bundle has one file per version (`restoreDataItemIdsOverwrittenByL1`).
- **Html with embedded images gets its second pass on the direct-EAS route, and on L1 it's funded** (its own reimbursement request) instead of needing AR in the user's key.
- **EIP-7702 wallets attest directly after their first publish too:** a delegated EOA's code no longer counts as a deployed contract.

### Commits

#### Fixes

- a new user's smart wallet is deployed on its first publish (ef3090bb)
- EIP-7702 wallets keep attesting directly after their first publish (8880e2a8)
- Html with embedded images gets its second pass, funded (30f176ea)
- sdk: local storage ids stay the attested data item ids (50818a6d)
- data items are signed by an EOA, never a smart account (39d09be9)
- a resumed bundler or Turbo publish can't skip its upload (b72e3425)
- packages: internal peers use workspace:*, published as the exact version (d2730d9a)
- direct EAS only for wallets that say they are EOAs (c8605311)
- sdk: Arweave and testnet gas estimates; upload docs (b5873c52)
- provider init order, useCanPublishItem, dead config and hook (8a4b34f2)
- ensure*ThenPublish report started only once a publish spawned (a7a74ced)
- connect sync, query, confirmation polling and uploadApiBaseUrl (176de73c)
- packages: top-level types for legacy resolvers; query main -> Node build (12c51228)
- make @seedprotocol/sdk and @seedprotocol/react peer dependencies (09ce9e2d)

#### Other

- packages: audit feed, feed-hyper, gateway-hyper, mapping, publish, query READMEs (1a5d7ee4)
- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

## 0.7.4 (2026-10-15)

### Commits

#### Features

- authorizePublish approves a publish before it spends (165481fa)
- users can pay for storage with Turbo credits (7d22873e)
- payment config and one resolution of who pays (f9fd4fe0)

#### Fixes

- ensureEasSchemas looks schemas up under the published name (1da9dc94)
- sdk, react: one easName for every name that reaches EAS (eec5ded5)
- disconnecting a wallet stops treating it as owned (d12c64c1)
- sdk: addresses saved by init are announced; connecting keeps watched addresses (a8029bcc)
- load the undeployed-account check only on the direct-EAS branch (b98ea731)
- refuse direct EAS for an undeployed smart account (ef06cf94)
- direct-EAS publish records each seed as it is attested (6819bb97)
- domain ownership attests what was proven and honours expiry (8c5ef8e3)
- revoke from the attester and skip already-revoked uids (220dcb0e)
- keep arweaveJwk and dataItemSigner out of saved publish snapshots (01d2d008)
- estimatePublishCost reports Arweave storage as not user-paid (0039b18d)
- estimatePublishCost reports who pays gas from the real sender (4655d738)

## 0.7.3 (2026-10-14)

### Commits

#### Features

- register publishItem as the executor behind item.publish() (79e461ec)

#### Other

- item.publish() needs @seedprotocol/publish (b90bc321)
- use the SDK's getPublishUploadData (fa8f2f84)

## 0.7.1 (2026-10-10)

### Commits

#### Features

- sdk: seed:property/<name> placeholders in Html resolve to the property's upload (ef4c28e9)

#### Fixes

- direct-to-EAS publish attests every list member's seed uid (9ff27038)
- sdk: publish the full graph of related drafts (c115dc30)

## 0.7.0 (2026-10-08)

### Commits

#### Features

- sdk: elect a leader tab for automatic EAS sync and the L1 worker (1d828074)
- sdk: record version revocations in versions.revoked_at (09649128)

#### Fixes

- resume each in-progress publish in one tab only (8d2c0d18)
- sdk: co-publish images embedded in related drafts' Html (0c47942e)
- direct-to-EAS publish records every request's own seed (0c4732ac)
- record every request of a one-transaction publish (a1875916)
- match each multiPublish request to its own receipt events (7505a50d)
- sdk: a patch publish's existing version uid is not recorded again (ecce0332)
- sdk: publishing a reference to an unpublished item fails (3c05c13c)
- sdk: propagate property revocations and replacements to stored metadata (13ddb58d)

## 0.6.10 (2026-10-04)

### Breaking

- **`waitForPublishReceipt` throws on a reverted transaction** (`PublishTransactionRevertedError`, with `transactionHash` and `receipt`). It used to return the reverted receipt, so callers treated a revert as success. Functions that return its receipt (`attestPublishAuthorization`, `revokePublishAuthorization`, domain ownership and publishedBy attest/revoke) now throw instead.
- **`ensureExecutorModuleInstalled` no longer calls `installModule` on thirdweb ModularCore accounts.** That path could never work: ModularCore installs modules by `delegatecall`, and the Seed executor is an ERC-7579 module without `getModuleConfig`. Accounts without the `SeedExecutorRouterExtension` are skipped, and `assertExecutorModuleReadyForAccount` reports why the executor can't act for them. `ensureExecutorModuleInstalled` now returns `{ status: 'skipped' | 'already-installed' }` or `{ status: 'installed', eas, transactionHash }`. `PublishConfig.modularAccountModuleData` is unused.

### Fixed

- **Sponsored managed-account UserOps running out of gas on large publishes:** thirdweb set `callGasLimit` to the bundler's estimate plus 50k, which tracks gas used, not gas required while the call runs (refunds are credited only at the end, and each nested call holds back 1/64). A large `multiPublish` on OP Sepolia needed about 1.08x that limit and failed with no revert reason. The sponsored managed wallet now sets thirdweb's `overrides.paymaster` hook to raise `callGasLimit` 1.2x (`CALL_GAS_HEADROOM_BPS`) before the paymaster signs, or to use the transaction's own `gas` if that's higher. EntryPoint v0.6 charges only for gas used. Unsponsored managed-account UserOps (`thirdweb.sponsorGas: false`) still use thirdweb's estimate.
- **`seedPaymaster(client, chain, bundlerUrl?)`** is exported from `@seedprotocol/publish/thirdweb` for smart wallets the SDK doesn't build, such as a server's `smartWallet()` with an automation session key: pass it as `overrides.paymaster` when `sponsorGas` is on.
- **Executor install race in `enrollPublishAutomation`:** turning on automation could fail with "The Seed executor is not installed for this ManagedAccount" right after a successful `installSeedExecutor`, because the follow-up `isInitialized` read hit a load-balanced RPC node that hadn't seen the block yet. The install is now confirmed from the receipt's `SeedExecutorInstalled` and `ModuleInitialized` logs, and the readiness check uses the EAS from that event instead of re-reading. When the executor was already installed, the `isInitialized` read is retried briefly. `ensureAutomationSessionKey` retries the `isActiveSigner` read after `addSessionKey` for the same reason.
- **Failed executor installs report why:** an install whose receipt lacks the install events (a reverted transaction, or a sponsored EIP-7702 relayer transaction that succeeded while the inner call reverted) throws `EXECUTOR_MODULE_NOT_INSTALLED` with the decoded revert reason, instead of a misleading "not installed" from the readiness check.

### Added

- **`readFactorySeedExecutor(factory?)`:** the executor and EAS that a ManagedAccount factory's `SeedExecutorRouterExtension` pins, or `null` when it routes none. Compare it with `modularAccountModuleContract` at startup instead of finding a stale address at the first publish or enroll.
- **`assertExecutorModuleReadyForAccount(address, { installedEas, readAttempts })`:** pass the EAS confirmed from an install receipt to skip the read, or retry a not-initialized read.

### Commits

#### Breaking

- confirm executor installs from the receipt, not a lagging read (e111c5d0)

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.9 (2026-10-03)

### Commits

#### Breaking

- encode multiPublish with publishIndex for SeedProtocolExtension (69318de1)

#### Other

- one multiPublish struct for the extension and the executor (ab765b75)

## 0.6.8 (2026-10-03)

### Fixed

- **List-of-relation EAS names:** a list relation such as `staff` (List → Identity) was attested as `bytes32[] staff` or `bytes32[] staff_identity_ids` depending on whether the model was loaded before the item. `getPublishPayload` and `ensureEasSchemasForItem` now derive the name from the property definition with `listRelationEasPropertyName` (exported from `@seedprotocol/sdk`) and ignore a cached `schemaUid` for list relations. `ensureEasSchemasForItem` refuses to register a list-relation schema that doesn't end in `_ids`. Locally, `createMetadata` writes list-relation rows under the storage name (`staffIdentityIds`), and an `ItemProperty` that receives its schema after construction moves to the storage name while `propertyName` stays `staff`. Already-published data (`author_identity_ids` and the like) is unchanged.
- **Missing property schemas fail publish validation:** when a property's EAS schema can't be found, `getPublishPayload` now reports `publish_schema_not_found` instead of attesting the value under the Version schema. Call `ensureEasSchemasForItem` first, as the publish flow already does.
- **`parseEasRelationPropertyName`** (`@seedprotocol/query`) pluralizes list names with `pluralize`: `staff_identity_ids` → `staff` (was `staffs`). Single relations return the singular (`cover_image_id` → `cover`).
- **Failed UserOps on the permissionless / EIP-7702 sender:** a UserOp that failed inside a successful bundle transaction was returned as a success, so publish went on with no attestations. It now throws with the decoded revert reason.
- **Readable publish failures:** every publish route now simulates `multiPublish` from the sending account before sending, and a call that would revert throws `PUBLISH_PREFLIGHT_FAILED` with the decoded Seed, EAS or `Error(string)` reason (automation keeps `AUTOMATION_PREFLIGHT_FAILED`). Outside automation, a simulation that can't run doesn't block the send. thirdweb's bare `UserOp failed at txHash: 0x…` (usually out of gas) and its undecodable custom-error message are rewritten to say what happened, as `ManagedAccountPublishError` with code `USEROP_FAILED_NO_REASON` (no revert reason; usually out of gas) or `USEROP_REVERTED`, keeping the original as `underlyingCause`. Failed UserOps on the permissionless sender use the same codes.
- **EAS schema lookup:** `ensureEasSchemasForItem` normalizes property data types (`html` → `Html`) before choosing the on-chain schema, so an existing `bytes32 html` schema is reused instead of registering `string html`. `normalizeDataType` is exported from `@seedprotocol/sdk`.
- **Automation schema registration:** session keys no longer send SchemaRegistry or EAS UserOps when a schema is missing. Publish fails first with `schema "…" is not registered; automation keys can't register schemas`. Register once with the owner wallet via `ensureEasSchemasForItem`.

### Commits

#### Features

- error codes for failed UserOps (72211c67)
- twin robustness and a twin.json config helper (b72399a9)
- local twin support and the contract rollout's client changes (65bbde80)
- verify the publish chain before writing; hold EAS sync until the chain is known (5f4fc0ee)
- sdk: record the EAS chain in the local DB and refuse cross-chain writes (7d8af9d5)
- sdk: read EAS from the configured chain and register base schemas on new chains (91e0290e)
- make the publish chain and EAS addresses configurable (811b8fc5)

#### Fixes

- attest list relations under one EAS name (55d6cbe2)
- readable UserOp failures and a pre-send check on every route (06f8674d)
- rollout and twin follow-ups from protocol review (415c9c1b)
- check executor module readiness before automation publish and revoke (4e8a4f8a)
- treat relations to published seed uids as already published (8133d761)
- normalize EAS schema types and refuse automation registration (b68fef38)

#### Other

- Lots of bug fixes (a3a7f146)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Fixed

- **Publish automation on legacy ManagedAccounts:** `enrollPublishAutomation` no longer fails when the account is an ERC-7504 Router (`Router: function does not exist`) instead of ModularCore. Those accounts cannot `installModule`; enroll adds the module-only session key and attests the sidecar. ModularCore accounts still require the executor module to be installed.
- **First-time modular publish:** `isAutomationSessionActive` returns `false` when the ManagedAccount has no bytecode instead of throwing `MODULAR_SIGNER_ACTIVATION_FAILED` on viem `0x` / “not a contract”. Interactive first publish can reach `runModularExecutorPublishPrep` / `autoDeployManagedAccount`. Deployed-account RPC or `isActiveSigner` read failures still throw so unattended automation does not fall through to in-app bootstrap.

### Commits

#### Features

- add PublishedBy batch sidecar attest/revoke/query APIs (14233083)

#### Fixes

- support Node server publishes without a browser Thirdweb client (7ef2fe66)
- import listCreatedAttestationPairsFromReceipt for PublishedBy batch (4da2fc80)

#### Other

- Final edits (687d320b)
- Build fixes (15ab8cdc)
- Fixing Vite plugin bugs (59fad217)
- Fix first-publish failing when the ManagedAccount is still undeployed. (84a921d6)

## 0.6.3 (2026-09-25)

_Also covers 0.6.1, 0.6.2, published from commits in this range._

### Commits

#### Other

- Fixing item ownership bugs/gaps (2539c65c)
- Adding publish cost estimator tooling (6d2f170c)
- Fixing bug so uid doesn't depend on CreatedAttestation (5e64192b)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Added

- **Publish automation grants:** ManagedAccount-hosted session keys (executor-module-only `approvedTargets`), `seedprotocol.publishAuthorization` sidecar, `enrollPublishAutomation` / `revokePublishAutomation`, and `assertStorageBoundToIdentity`. See `docs/PUBLISH_AUTOMATION.md`.
- **`prepareEasMultiRevoke`:** When `modularAccountModuleContract` is set, routes `multiRevoke` to the executor module so automation session keys can revoke as the ManagedAccount.
- **`resolveRevokeAccount` / `revokeAttestations`:** No longer hard-block ManagedAccount attesters; legacy module-attester path attempts ManagedAccount + executor revoke when configured.
- **Automation `multiPublish` path:** When the provided publish wallet signer is an active session key on the ManagedAccount, `createAttestations` keeps that wallet (no modular in-app bootstrap), routes `multiPublish` to the executor module (`routeToExecutorModule`), and uses read-only **`assertManagedAccountEasMatchesConfig`** (session keys cannot `setEas`).
- Dependency: `@seedprotocol/arweave` (workspace) for SDK-resolution stability when publish loads SDK revoke/sync paths.

### Added (Domain ownership)

- **Domain ownership tooling:** `createDomainOwnershipChallenge`, multi-resolver DNS TXT verify, RDAP snapshot via `rdapper`, `ensureDomainOwnershipSchema` / `attestDomainOwnership` / `revokeDomainOwnership`, `verifyAndAttestDomainOwnership`, and `assessDomainOwnershipLive`. See `docs/DOMAIN_OWNERSHIP.md`.
- Dependency: `@seedprotocol/eas`, `rdapper`.

### Commits

#### Features

- route automation session keys through the executor (5894cbc2)
- add ManagedAccount publish automation enrollment (db6d752f)

#### Other

- Add domain ownership DNS challenge, RDAP snapshot, and EAS sidecar tooling. (c51a1226)

## 0.5.1 (2026-08-29)

### Commits

#### Features

- add permissionless EIP-7702 sender for gasless publish (1c907e64)
- add EIP-1193 PublishWallet and useSeedWallet (fb5dfdab)
- make Thirdweb an optional peer behind /thirdweb (2bc918dc)
- resolve chain and RPC from PublishConfig (23b24b66)

#### Fixes

- sync in-app auth tokens for managed wallet connect (4e1caadf)
- sdk: guard BaseDb readiness before platform classes init (425883c3)

#### Other

- replace setPlatformClass with instance + static facade (0bca44b7)
- Fixing imports/exports (3869c666)
- document EIP-1193, permissionless, and Thirdweb recipes (221e007f)
- split SeedSigner and SeedTxSender (11c0d8e1)
- Decouple publish contract/tx layer via SeedSigner and viem. (537c0e15)

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
