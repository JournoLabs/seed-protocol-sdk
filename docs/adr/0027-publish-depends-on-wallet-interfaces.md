# 0027. Core publish depends on wallet interfaces and standard RPC, not vendor SDKs

- **Status:** Accepted
- **Date:** 2026-10-30
- **Scope:** `@seedprotocol/publish`

## Context

Publish was built on Thirdweb: in-app wallets, session-key grants, UserOp sponsorship and account deploys all called its SDK. An app that wanted another wallet or paymaster could not publish through a ManagedAccount, and the core entry imported `thirdweb` even though it is an optional peer, so an app without it failed on import. The EIP-7702 sender had a similar tie to Pimlico: it called `pimlico_getUserOperationGasPrice` unconditionally.

Who holds the key and who bundles UserOps are separate choices, and the protocol shouldn't make either one for an app.

## Decision

`@seedprotocol/publish` publishes, enrolls automation keys and revokes through `PublishWallet` (`SeedSigner` + `SeedTxSender`) and these standards: ERC-4337 bundler RPC and ERC-7677 paymaster RPC.

- Code reachable from `packages/publish/src/index.ts` has no static import of a vendor SDK. Thirdweb stays behind `@seedprotocol/publish/thirdweb` or in dynamic imports on Thirdweb paths. `scripts/check-publish-core-no-thirdweb.js` enforces this.
- An adapter for a wallet vendor converts to `PublishWallet` and takes a structural type rather than a dependency, as `fromPrivyWallet` does. If an adapter ever needs a vendor's package, it gets its own subpath and an optional peer.
- Vendor RPC methods are optional. `pimlico_getUserOperationGasPrice` is used when the bundler answers it, with the chain's fee estimate as the fallback.
- The ManagedAccount contracts stay: Thirdweb's account with Seed's `SeedExecutorRouterExtension`, on EntryPoint v0.6. `createManagedAccountTxSender` sends from them with permissionless's `toThirdwebSmartAccount`, which is RPC and encoding, not the Thirdweb SDK.

## Consequences

Apps can bring a wallet and a bundler or paymaster with no Thirdweb install. The Thirdweb flow keeps working through `/thirdweb`, which stays the only path with in-app login and automatic account setup.

Without Thirdweb, an app does more itself: it deploys the account with a first UserOp, installs the executor from the admin EOA, which needs gas for that transaction, and registers the session with `publisherAddress`.

Breaking under `## Unreleased` in `packages/publish/CHANGELOG.md`: `ensureAutomationSessionKey`, `removeAutomationSessionKey`, `enrollPublishAutomation`, `revokePublishAutomation` and `ensureExecutorModuleInstalled` take wallets in the core entry, and `ensureManagedSignerSessionKey`, `defaultApprovedTargetsForModularPublish` and `toThirdwebSessionKeyPermissions` are gone.

Watch EntryPoint v0.6: a provider that drops it can't serve a ManagedAccount. Thirdweb's account contracts are still the on-chain dependency, so this ADR makes the SDK vendor-neutral, not the contracts. Other account types (Safe, Kernel, Nexus) need Seed's executor to work as an ERC-7579 module, which is contract work and a separate decision.

## Alternatives considered

Keeping Thirdweb in core with other wallets alongside it: fails the import for apps without the peer, and leaves grants and sponsorship tied to one vendor.

A plugin interface per provider: bundlers and paymasters already share a standard, so per-vendor plugins would add code without adding reach.

Rebasing `feat/vendor-neutral-modular-publish`: it targeted EntryPoint v0.7 and a ModularCore install that main no longer uses, and was 1,273 commits behind.
