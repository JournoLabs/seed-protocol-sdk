# @seedprotocol/publish

Publish UI components and helpers for Seed Protocol.

The publish flow (ConnectButton, etc.) runs `ensureEasSchemasForItem` before `getPublishPayload`, which registers EAS schemas and adds naming attestations so EASSCAN displays them. If you build a custom publish flow that calls `item.getPublishPayload()` directly, you must run schema setup first or use this package's flow.

## Setup

Wrap your app with `PublishProvider` so that `ConnectButton` and other publish components work correctly. The provider includes:

- Thirdweb's required context (React Query, connection manager)
- SeedProvider (React Query for Seed SDK hooks like `useItems`, `useModels`, `useSchemas`)

You can optionally pass `queryClient` or `queryClientRef` to customize the Seed QueryClient.

`thirdwebClientId` and `uploadApiBaseUrl` are required. Other values (account factory, EAS contract) are defined as constants in the package.

### useIntegerLocalIds

When using the new contract that expects `uint256` localIdIndex/publishLocalIdIndex instead of string localId/publishLocalId (gas-efficient), set `useIntegerLocalIds: true`:

```tsx
initPublish({
  thirdwebClientId: '...',
  uploadApiBaseUrl: '...',
  useIntegerLocalIds: true,  // Use integer-based payload for new contract
})
```

To revert to the old contract (string-based), set `useIntegerLocalIds: false` or omit the flag. No code changes required beyond config.

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

## Development

```bash
bun install
bun run build
```
