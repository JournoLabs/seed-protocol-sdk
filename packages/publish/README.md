# @seedprotocol/publish

Publish UI components and helpers for Seed Protocol.

The publish flow (ConnectButton, etc.) runs `ensureEasSchemasForItem` before `getPublishPayload`, which registers EAS schemas and adds naming attestations so EASSCAN displays them. If you build a custom publish flow that calls `item.getPublishPayload()` directly, you must run schema setup first or use this package's flow.

## Setup

Wrap your app with `PublishProvider` so that `ConnectButton` and other publish components work correctly. The provider includes:

- Thirdweb's required context (React Query, connection manager)
- SeedProvider (React Query for Seed SDK hooks like `useItems`, `useModels`, `useSchemas`)

You can optionally pass `queryClient` or `queryClientRef` to customize the Seed QueryClient.

### Option A: Config via provider

```tsx
import { PublishProvider, ConnectButton } from '@seedprotocol/publish'

function App() {
  return (
    <PublishProvider
      config={{
        thirdwebClientId: 'your-client-id',
        thirdwebAccountFactoryAddress: '0x...',
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
  thirdwebClientId: 'your-client-id',
  thirdwebAccountFactoryAddress: '0x...',
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
