# Changelog

All notable changes to this project will be documented in this file.

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
