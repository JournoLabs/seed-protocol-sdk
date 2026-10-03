# @seedprotocol/publish

Publish UI components and helpers for Seed Protocol.

The publish flow (ConnectButton, etc.) runs `ensureEasSchemasForItem` before `getPublishPayload`, which registers EAS schemas and adds naming attestations so EASSCAN displays them. If you build a custom publish flow that calls `item.getPublishPayload()` directly, you must run schema setup first or use this package's flow.

`initPublish()` or `PublishProvider` registers the revocation executor, so `item.unpublish()` works when the publish package is configured. See [docs/ATTESTATION_REVOCATION.md](../../docs/ATTESTATION_REVOCATION.md) for permanence and UX guidance.

**Badges / on-chain vs pending:** use `@seedprotocol/sdk` `getSeedPublishState` for “any on-chain anchor for this seed”, `getPublishPendingDiff` for per-property heads missing attestation UIDs, and `getItemsData` (`includeEas`, `publishedVersionUid` vs `latestVersionUid`) for list rows. When a publish run finishes, observe `usePublishProcess(seedLocalId)` or the `publishProcesses` table instead of ad hoc window events.

## Setup

`uploadApiBaseUrl` is required. Provide either `rpcUrl` or `thirdwebClientId` (RPC falls back to Thirdweb’s edge when only the client id is set).

From Node, a domain-locked client id returns 401. Set `thirdwebSecretKey` (server only) so Thirdweb RPC and the bundler authenticate, and either pass a public `rpcUrl` or pass `thirdwebClientId` together with that secret (`x-secret-key` is attached to viem reads). A secret key alone does not build the viem RPC URL. Call `await PublishManager.ready()` before `createPublish`; that promise is the spawned actor, not the finished publish. eas-sdk’s ESM build named-imports CommonJS `lodash`. Load it with `node --import @seedprotocol/sdk/node-eas-lodash`, which redirects that import to `lodash-es`.

Thirdweb is an **optional** peer. Core publish uses `SeedSigner` + `SeedTxSender` (`PublishWallet`). Import ConnectButton / in-app wallets from `@seedprotocol/publish/thirdweb`.

### Recipe 1: EIP-1193 + EOA (no Thirdweb)

User pays gas. Works with MetaMask / injected wallets.

```tsx
import {
  PublishProvider,
  useSeedWallet,
  ensureWalletThenPublish,
  initPublish,
} from '@seedprotocol/publish'
import { optimismSepolia } from 'viem/chains'

initPublish({
  uploadApiBaseUrl: import.meta.env.VITE_UPLOAD_API_BASE_URL,
  rpcUrl: import.meta.env.VITE_RPC_URL,
  chain: optimismSepolia,
  accountMode: 'eoa',
})

function Connect() {
  const { status, connect, address } = useSeedWallet()
  return (
    <button
      onClick={() => connect((window as any).ethereum)}
      disabled={status === 'connecting'}
    >
      {address ?? 'Connect wallet'}
    </button>
  )
}

function App() {
  return (
    <PublishProvider>
      <Connect />
    </PublishProvider>
  )
}

// Later:
// await ensureWalletThenPublish(item, { dataItemSigner: /* from useSeedWallet().signer */ })
```

### Recipe 2: EIP-1193 + permissionless EIP-7702 (gasless, no Thirdweb)

```tsx
initPublish({
  uploadApiBaseUrl: import.meta.env.VITE_UPLOAD_API_BASE_URL,
  rpcUrl: import.meta.env.VITE_RPC_URL,
  chain: optimismSepolia,
  accountMode: 'eip7702',
  bundlerUrl: import.meta.env.VITE_BUNDLER_URL,
  paymasterUrl: import.meta.env.VITE_PAYMASTER_URL, // optional; defaults to bundlerUrl
})
```

`useSeedWallet().connect(provider)` upgrades the EOA sender to a permissionless EIP-7702 `SeedTxSender` when `accountMode` is `eip7702` and `bundlerUrl` is set. ModularCore / ManagedAccount session-key flows remain Thirdweb-only.

### Recipe 3: Thirdweb ConnectButton (batteries-included)

```tsx
import { initPublish } from '@seedprotocol/publish'
import {
  PublishProvider,
  ConnectButton,
} from '@seedprotocol/publish/thirdweb'

initPublish({
  thirdwebClientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID,
  uploadApiBaseUrl: import.meta.env.VITE_UPLOAD_API_BASE_URL,
})

function App() {
  return (
    <PublishProvider
      config={{
        thirdwebClientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID,
        uploadApiBaseUrl: import.meta.env.VITE_UPLOAD_API_BASE_URL,
      }}
    >
      <ConnectButton />
    </PublishProvider>
  )
}
```

You can optionally pass `queryClient` or `queryClientRef` to customize the Seed QueryClient.

### Choosing a chain

Publishing works on any EVM chain with [EAS](https://github.com/ethereum-attestation-service/eas-contracts#deployments) deployed. Pass a viem `chain`; it defaults to Optimism Sepolia. The same chain drives viem reads, transaction routing and the Thirdweb wallet / ConnectButton. When `rpcUrl` is set, Thirdweb uses it too, so Seed's checks and Thirdweb's calls always reach the same node.

```ts
import { base } from 'viem/chains'

initPublish({
  uploadApiBaseUrl: import.meta.env.VITE_UPLOAD_API_BASE_URL,
  rpcUrl: import.meta.env.VITE_RPC_URL,
  chain: base,
})
```

- **Known chains** (`EAS_CHAIN_DEPLOYMENTS`: Ethereum, Sepolia, Optimism, Optimism Sepolia, Base, Base Sepolia, Arbitrum One / Sepolia, Polygon, Scroll, Linea) resolve the EAS and SchemaRegistry addresses automatically.
- **Other chains** need `easContractAddress` and `schemaRegistryAddress`; `initPublish` throws without them. These options also override the built-in addresses on known chains.
- **Managed / modular account flows** (Thirdweb ManagedAccount, `useModularExecutor`) need a ManagedAccount factory on the chain. One is built in for Optimism Sepolia only (`MANAGED_ACCOUNT_FACTORY_ADDRESSES`); elsewhere pass `managedAccountFactoryAddress` and an executor module you have deployed. The EOA / direct EAS path needs neither.
- `ensureEasSchemasForItem` registers missing model and property schemas on first publish. The base schemas (Version and EAS's "Name a Schema") are registered by the protocol for each supported chain (seed-protocol `seed:ensure-schemas`); if one is missing, publishing fails before sending anything.
- SDK reads (EAS sync, schema lookups) follow the publish chain's easscan indexer automatically. For a chain without a known indexer, or a self-hosted one, set `SeedConfig.eas.indexerUrl`. If the SDK sets `eas.chainId`, it must match `chain.id` or init throws. The `EAS_ENDPOINT` / `NEXT_PUBLIC_EAS_ENDPOINT` env vars still override the chain's default indexer, but one set to another chain's known easscan indexer throws (`SeedConfig.eas.indexerUrl` takes precedence over both).
- The SDK's local database remembers which chain its attestations came from. Pointing an existing database at a different chain fails at init, sync or publish with a chain-mismatch error rather than mixing data from two chains. Use a separate `filesDir` / database per chain. Databases created before this check are treated as Optimism Sepolia.
- Before the first publish or revoke, `verifyPublishChain()` checks that the RPC reports `chain.id` and that EAS, the SchemaRegistry and any configured factory / executor module have code on the chain. It throws `PublishChainConfigError` listing every problem. Call it at startup to fail earlier.
- While `@seedprotocol/publish` is loaded but `initPublish` hasn't run, SDK EAS sync waits (up to 30s) for the publish chain instead of syncing the default chain. Set `SeedConfig.eas.chainId` to skip the wait.

The resolved values are on `getPublishConfig()` (`chain`, `easContractAddress`, `schemaRegistryAddress`, `thirdwebAccountFactoryAddress`, `easChain`).

### Local OP Sepolia twin

The protocol's twin (`seed-protocol`: `bun run twin:up`) is an OP Sepolia fork on chain **31337** with a local bundler (no paymaster) and EAS indexer. Thirdweb's hosted paymaster and EIP-7702 service can't reach it, so the wallets need the `thirdweb` settings below. `seedTwinConfig` reads the endpoints and addresses from `seed-protocol/.twin/twin.json`, which change with each deploy; it ignores the file's test-account keys.

```ts
import { initPublish, seedTwinConfig } from '@seedprotocol/publish'
import twinJson from '../seed-protocol/.twin/twin.json'

const twin = seedTwinConfig(twinJson)

initPublish({
  ...twin.publish, // chain 31337, rpcUrl, addresses, executor, thirdweb: { bundlerUrl, sponsorGas: false, modularWalletMode: 'EOA' }
  uploadApiBaseUrl: 'http://localhost:3000', // your seed-protocol-server
  thirdwebClientId, // login stays hosted; allow the local origin
  useModularExecutor: true,
})

// SDK
client.init({ config: { ...config, eas: twin.eas, filesDir: `.seed-${twin.chain.id}` } })
```

Configuring the twin by hand instead: the twin's bundler goes in `thirdweb.bundlerUrl`, not the top-level `bundlerUrl`. That one feeds the permissionless EIP-7702 sender, needs an EntryPoint v0.8 bundler (the twin's is v0.6) and is rejected when the bundler reports no v0.8 support. On a local chain (31337 / 1337, or a loopback RPC), the Thirdweb wallets throw for `modularWalletMode: 'EIP7702'` and for a missing `thirdweb.bundlerUrl`, since Thirdweb's hosted services can't reach it.

Fund both the ManagedAccount and the in-app EOA before publishing: `bun run twin:fund <managedAddress> <eoaAddress>` in `seed-protocol`. Each `twin:up` resets the chain, so clear the local Seed DB (`filesDir`) and browser storage too.

Twin quirks the SDK handles: automation pre-flight simulations retry with a balance override when the account can't cover OP's up-front L1 fee, EOA sends retry when the fork's pending-nonce lookup lags a block, and `getArweave()` follows the gateway's protocol and port (e.g. `http://localhost:1984`).

### Experimental: Arweave bundler (instant uploads)

When using your own gateway with an Arweave bundler, you can enable instant uploads instead of the default reimbursement + chunk upload flow. **This is experimental and not yet validated for production.**

**Memory:** Large publishes hold signed DataItems and a single packed batch body in memory briefly. Electron and other Chromium renderers often cap near ~4 GB JS heap. See [docs/PUBLISH_MEMORY.md](../../docs/PUBLISH_MEMORY.md) for scaling, `publishMode`, and path differences (`signDataItems` vs `dataItemSigner`).

Set `useArweaveBundler: true`. The bundler uses the same `uploadApiBaseUrl` (e.g. `${uploadApiBaseUrl}/upload/batch`).

```tsx
<PublishProvider
  config={{
    thirdwebClientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID,
    uploadApiBaseUrl: import.meta.env.VITE_UPLOAD_API_BASE_URL,
    useArweaveBundler: true,
  }}
>
  <App />
</PublishProvider>
```

When using the bundler, you must provide a signer at publish time via `PublishManager.createPublish` options:

```tsx
// Signer passed at publish time (recommended for apps where signer isn't available at startup)
PublishManager.createPublish(item, address, account, {
  signDataItems: async (uploads) => {
    // Sign with wallet (ArConnect, MetaMask, etc.)
    return uploads.map((u) => ({ transaction: { id: '...' }, versionId: u.versionLocalId, modelName: u.itemPropertyName }))
  },
})

// Or for backend/scripts with a private key:
PublishManager.createPublish(item, address, account, {
  dataItemSigner: myArweaveSigner,
})
```

You can also provide `signDataItems` or `dataItemSigner` in the PublishProvider config as a fallback when the signer is available at startup.

**Html properties with embedded `data:image/...;base64,...` (materialization):** When `useArweaveBundler: true`, the publish machine runs the same two-phase flow as L1: phase 1 uploads non-deferred payloads (including materialized Image DataItems), rewrites Html files on disk with Arweave URLs, then phase 2 builds and uploads Html-only DataItems. **`signDataItems` is invoked twice per publish** in that scenario (once per phase)—implementations should sign/upload the `uploads` array they receive each time. The in-process **`dataItemSigner`** path performs two HTTP batch uploads to your bundler API. Per-property `htmlEmbeddedDataUriPolicy: 'preserve'` skips materialization and keeps a single phase.

### Arweave upload tags

Add optional tags (e.g. `App-Name`) on **`PublishProvider` / `initPublish` config** as **`arweaveUploadTags`**, and/or per publish via **`createPublish` options**. Resolved order: **`[...configTags, ...perPublishTags]`**, appended after `Content-SHA-256` / `Content-Type` on each upload.

When implementing **`signDataItems`**, use **`upload.tags`** as the tag list for each DataItem. Avoid rebuilding tags from `contentHash` / `contentType` only, or you will drop configured tags.

### Publish process history

Local publish runs are stored in SQLite (`publish_processes`). Useful exports from `@seedprotocol/publish`:

| Need | API |
|------|-----|
| All runs, newest first (global activity) | `usePublishProcesses()`, or `usePublishProcessesState()` if you also need a non-`in_progress` count in one subscription |
| Runs for one seed only | `usePublishProcessesForSeed(seedLocalId)`, or `usePublishProcessesStateForSeed(seedLocalId)` |
| Non-active count only | `usePublishProcessesNonActiveCount()` or `usePublishProcessesNonActiveCountForSeed(seedLocalId)` |
| Clear finished runs (keep `in_progress`) app-wide | `clearCompletedPublishProcesses()` |
| Clear finished runs for one seed only | `clearCompletedPublishProcessesForSeed(seedLocalId)` |
| Remove one run by row id | `deletePublishProcessById(id)` |
| Remove many runs by row ids | `deletePublishProcessesByIds(ids)` |
| Wipe **all** history for a seed (including in-progress) | `deletePublishProcessesForSeed(seedLocalId)` — deletes every row for that seed, not a single run |

```ts
import {
  usePublishProcessesStateForSeed,
  clearCompletedPublishProcessesForSeed,
  deletePublishProcessById,
} from '@seedprotocol/publish'

// Per-seed history + “clear finished for this seed” without scanning the full table
const { records } = usePublishProcessesStateForSeed(item.seedLocalId)
await clearCompletedPublishProcessesForSeed(item.seedLocalId)
await deletePublishProcessById(runId) // numeric row id from `records`
```

### Publish automation (ManagedAccount grants)

Apps can enroll a server-held session key to publish/revoke on a user’s ManagedAccount without taking the user’s root key. Requires `modularAccountModuleContract` (executor-module-only `approvedTargets`). See [docs/PUBLISH_AUTOMATION.md](../../docs/PUBLISH_AUTOMATION.md).

APIs live on `@seedprotocol/publish` (sidecar attest/revoke) and `@seedprotocol/publish/thirdweb` (`enrollPublishAutomation`, `revokePublishAutomation`, session-key helpers, `assertStorageBoundToIdentity`).

### Modular executor (`useModularExecutor`)

With **`useModularExecutor`**, two Thirdweb in-app wallets share one login:

- **Managed wallet** (`getManagedAccountWallet`, EIP-4337): the user's **ManagedAccount** smart account, created by the ManagedAccount factory with the user's in-app EOA as admin. It is the attester, and it publishes.
- **Modular wallet** (`getModularAccountWallet`): that same in-app EOA. It signs DataItems and sends the few **admin-only** transactions, such as `installSeedExecutor`. `thirdweb.modularWalletMode` picks EIP-7702 through Thirdweb (default; gas-sponsored unless `thirdweb.sponsorGas` is `false`) or a plain funded EOA (`'EOA'`); the address is the same either way.

**Publishing.** `createAttestations` sends interactive `multiPublish` as a **UserOp from the managed smart account**, calling the account itself (`execute(account, multiPublish)`). The Seed extension accepts that self-call; direct calls from session keys or other non-admins revert with `Unauthorized`. Before the first publish, `ensureModularPublishBootstrap`:

1. Connects the managed wallet and checks it is the publishing account.
2. Checks the account's `getEas()` against `easContractAddress`. Current Seed extensions fix EAS at deployment, so a mismatch is a config error. Only pre-rollout accounts that report no EAS get `setEas`, sent by the admin EOA.

**Executor.** `runModularExecutorPublishPrep()` ensures the ManagedAccount is deployed and, when `modularAccountModuleContract` is set, tries to install the Seed executor: `installSeedExecutor()` from the admin EOA on Router accounts with the `SeedExecutorRouterExtension`, `installModule` on ModularCore accounts. Interactive publishing doesn't use the executor, so a failed install (for example, `modularAccountModuleContract` naming a different executor than the one the account's extension pins) only logs a warning. `enrollPublishAutomation` requires the install and fails with `EXECUTOR_MODULE_NOT_INSTALLED`.

**Session keys** may only target the executor (`approvedTargetsForAutomationPublish`). `ensureManagedSignerSessionKey` and `defaultApprovedTargetsForModularPublish` are deprecated: interactive publishing needs no session key, and both now grant the executor only, never the account (which would allow any self-call) or EAS.

**Automation** session keys publish through the executor only (see [PUBLISH_AUTOMATION.md](../../docs/PUBLISH_AUTOMATION.md)) and cannot revoke. **Revocation** is owner-only: `revokeAttestations` sends `multiRevoke` to EAS from the publishing account.

**Routing:** `multiPublish` calldata uses the ABI generated from the reference deployment `MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA` (`0xcd8c…`). The transaction `to` is the managed account for interactive publish, or the executor module for automation keys. Non-modular publish targets the deployed publisher contract. **EOAs** (no contract at `address`) never use `multiPublish`; they attest on EAS directly (`createAttestationsDirectToEas`). Set **`useDirectEas: true`** to force that path.

**`ensureSmartWalletThenPublish`:** with `useModularExecutor`, the default `dataItemSigner` comes from `getConnectedModularAccount()`; the `activeAccount` argument is ignored on this path.

**Resolved config:** use **`getPublishConfig()`** after `initPublish` / `PublishProvider` for resolved defaults, not only `usePublishConfig()`, which returns the raw `PublishConfig`.

## Development

```bash
bun install
bun run build
```
