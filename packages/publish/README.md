# @seedprotocol/publish

Publish UI components and helpers for Seed Protocol.

The publish flow (ConnectButton, etc.) runs `ensureEasSchemasForItem` before `getPublishPayload`, which registers EAS schemas and adds naming attestations so EASSCAN displays them. If you build a custom publish flow that calls `item.getPublishPayload()` directly, you must run schema setup first or use this package's flow.

`initPublish()` or `PublishProvider` registers the revocation executor, so `item.unpublish()` works when the publish package is configured. See [docs/ATTESTATION_REVOCATION.md](../../docs/ATTESTATION_REVOCATION.md) for permanence and UX guidance.

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

### Arweave upload tags

Add optional tags (e.g. `App-Name`) on **`PublishProvider` / `initPublish` config** as **`arweaveUploadTags`**, and/or per publish via **`createPublish` options**. Resolved order: **`[...configTags, ...perPublishTags]`**, appended after `Content-SHA-256` / `Content-Type` on each upload.

When implementing **`signDataItems`**, use **`upload.tags`** as the tag list for each DataItem. Avoid rebuilding tags from `contentHash` / `contentType` only, or you will drop configured tags.

## Development

```bash
bun install
bun run build
```
