# @seedprotocol/ipfs

IPFS blob store for `@seedprotocol/publish`: CIDs computed before upload, CAR uploads to a Kubo node
or Pinata, and gateway URLs for `ipfs://` ids.

```ts
import { arweaveBlobStore } from '@seedprotocol/publish'
import { ipfsMirror, kuboRpcPinning } from '@seedprotocol/ipfs'

initPublish({
  // ...
  blobStore: ipfsMirror(arweaveBlobStore, { pinning: kuboRpcPinning({ url: 'http://127.0.0.1:5001' }) }),
})
```

See [docs/IPFS.md](../../docs/IPFS.md).
