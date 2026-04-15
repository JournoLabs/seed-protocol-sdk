# @seedprotocol/publish

Publish UI components and helpers for Seed Protocol.

The publish flow (ConnectButton, etc.) runs `ensureEasSchemasForItem` before `getPublishPayload`, which registers EAS schemas and adds naming attestations so EASSCAN displays them. If you build a custom publish flow that calls `item.getPublishPayload()` directly, you must run schema setup first or use this package's flow.

`initPublish()` or `PublishProvider` registers the revocation executor, so `item.unpublish()` works when the publish package is configured. See [docs/ATTESTATION_REVOCATION.md](../../docs/ATTESTATION_REVOCATION.md) for permanence and UX guidance.

**Badges / on-chain vs pending:** use `@seedprotocol/sdk` `getSeedPublishState` for “any on-chain anchor for this seed”, `getPublishPendingDiff` for per-property heads missing attestation UIDs, and `getItemsData` (`includeEas`, `publishedVersionUid` vs `latestVersionUid`) for list rows. When a publish run finishes, observe `usePublishProcess(seedLocalId)` or the `publishProcesses` table instead of ad hoc window events.

## Setup

Wrap your app with `PublishProvider`. The provider includes:

- Thirdweb's required context (React Query, connection manager)
- SeedProvider (React Query for Seed SDK hooks like `useItems`, `useModels`, `useSchemas`)

You can optionally pass `queryClient` or `queryClientRef` to customize the Seed QueryClient.

`thirdwebClientId` and `uploadApiBaseUrl` are required in config. Other values (account factory, EAS contract) are defined as constants in the package.

### Option A: Config via provider

```tsx
import { PublishProvider, ConnectButton } from '@seedprotocol/publish'

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

### Option B: Config via initPublish

```tsx
import { PublishProvider, ConnectButton, initPublish } from '@seedprotocol/publish'

initPublish({
  thirdwebClientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID,
  uploadApiBaseUrl: import.meta.env.VITE_UPLOAD_API_BASE_URL,
})

function App() {
  return (
    <PublishProvider>
      <ConnectButton />
    </PublishProvider>
  )
}
```

### useIntegerLocalIds

When using the new contract that expects `uint256` localIdIndex/publishLocalIdIndex instead of string localId/publishLocalId (gas-efficient), set `useIntegerLocalIds: true`:

```tsx
<PublishProvider
  config={{
    thirdwebClientId: '...',
    uploadApiBaseUrl: '...',
    useIntegerLocalIds: true,  // Use integer-based payload for new contract
  }}
>
  <App />
</PublishProvider>
```

To revert to the old contract (string-based), set `useIntegerLocalIds: false` or omit the flag. No code changes required beyond config.

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

### Modular executor (`useModularExecutor`) and EIP-7702

When **`useModularExecutor`** is enabled, `multiPublish` is sent **from** the user’s **Thirdweb in-app modular wallet** (EIP-7702 execution mode) against their **ManagedAccount** contract. Before the first on-chain publish, `createAttestations` runs **`ensureEip7702ModularAccountReady()`**, which checks Optimism Sepolia bytecode at the modular wallet address (EIP-7702 delegation / minimal account). If bytecode is still empty and **`autoDeployEip7702ModularAccount`** is true (the default when `useModularExecutor` is on), it calls Thirdweb’s **`deploySmartAccount`** bootstrap (no-op if already upgraded). Set **`autoDeployEip7702ModularAccount: false`** to surface **`Eip7702ModularAccountPublishError`** instead of auto-deploying.

**`ensureSmartWalletThenPublish`:** With **`useModularExecutor`**, the publish machine’s **`account`** and default **`dataItemSigner`** come from **`getConnectedModularAccount()`** (the modular EIP-7702 in-app wallet), not from **`resolveSmartWalletForPublish`** or the **`activeAccount`** argument (that parameter is ignored on this path for API compatibility). **`ensureEip7702ModularAccountReady()`** runs once before **`createPublish`** so EIP-7702 readiness failures surface before the publish actor starts; `createAttestations` still calls it again (no-op when already deployed).

**Routing (important):** `multiPublish` calldata uses the ABI generated from the reference deployment `MULTI_PUBLISH_ABI_REFERENCE_ADDRESS_OP_SEPOLIA` (`0xcd8c…` — same hex as the deprecated `SEED_PROTOCOL_CONTRACT_ADDRESS_OP_SEPOLIA` alias). The transaction **`to` / `getContract` address** is always the user’s on-chain publisher: **managed account** when `useModularExecutor` is on (`runModularExecutorPublishPrep().managedAddress`), or the **deployed publisher contract** when modular is off. **EOAs** (no contract at `address`) never use `multiPublish`; the publish machine routes them to **direct EAS** (`createAttestationsDirectToEas`). Set **`useDirectEas: true`** to force that path even when the publisher is a deployed contract. Receipt parsing uses `modularAccountModuleContract` when configured, otherwise the managed / publisher address.

**Managed account:** `runModularExecutorPublishPrep()` still ensures the **EIP-4337 managed** publishing contract exists on Optimism Sepolia (and optionally installs the executor module). That is separate from the modular wallet’s EIP-7702 upgrade.

Before the first `multiPublish` on that path, `createAttestations` runs **`ensureManagedAccountEasConfigured`**: it reads **`getEas`** on the ManagedAccount and, if the stored address is zero or does not match **`getPublishConfig().easContractAddress`**, sends **`setEas`** (signed by the same modular EIP-7702 account as `multiPublish`) and waits for the receipt. You can call **`ensureManagedAccountEasConfigured(managedAddress, modularAccount)`** yourself if you build a custom publish entrypoint.

**Diagnostic helper:** **`defaultApprovedTargetsForModularPublish(managedAddress)`** remains exported for apps that build custom permission flows; the publish package no longer provisions session signers on the managed account automatically.

**Resolved config:** Use **`getPublishConfig()`** after `initPublish` / `PublishProvider` for **`autoDeployEip7702ModularAccount`** and other resolved defaults—not only `usePublishConfig()`, which returns the raw `PublishConfig` object.

## Development

```bash
bun install
bun run build
```
