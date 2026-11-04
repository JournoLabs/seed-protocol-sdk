# IPFS

`@seedprotocol/ipfs` writes the files of a publish (Image, File, Html and Json uploads) to IPFS. It
plugs into `@seedprotocol/publish` as a blob store (`PublishConfig.blobStore`, ADR 0026). Arweave
stays the default store; the usual setup keeps Arweave and adds an IPFS copy of each file.

```bash
bun add @seedprotocol/ipfs
```

## Mirror Arweave uploads to IPFS

```ts
import { arweaveBlobStore } from '@seedprotocol/publish'
import { ipfsMirror, kuboRpcPinning } from '@seedprotocol/ipfs'

initPublish({
  // ...
  blobStore: ipfsMirror(arweaveBlobStore, {
    pinning: kuboRpcPinning({ url: 'http://127.0.0.1:5001' }),
  }),
})
```

`ipfsMirror(store, options)` attests the wrapped store's ids, so Seeds publish and download as they
do with Arweave alone. For each upload it:

1. computes the file's CID (see [CIDs](#cids)) and adds an `IPFS-CID` tag with it to the upload, so
   the Arweave data item names its IPFS copy and a GraphQL tag query finds the Arweave copy from a
   CID;
2. sends the upload to the wrapped store and the CAR to every pinning provider at the same time;
3. before attesting, waits until both stores hold it. A pin that never lands fails the publish, as
   a failed Arweave upload does.

An app's `signDataItems` receives the uploads with the `IPFS-CID` tag already in `upload.tags`.

## IPFS as the only store

```ts
import { ipfsBlobStore, pinataPinning } from '@seedprotocol/ipfs'

blobStore: ipfsBlobStore({
  pinning: pinataPinning({ jwt: process.env.PINATA_JWT! }),
  gateways: ['https://example.mypinata.cloud'],
})
```

Each file's `storage_transaction_id` is then `ipfs://<cidv1>`. Two parts of the SDK still assume
Arweave ids, so this mode is not ready for apps yet:

- Readers on other devices download a `storage_transaction_id` from Arweave, so these files don't
  download there until the SDK maps `ipfs://` ids to gateway URLs. `ipfsGatewayUrls` (below) is the
  piece that mapping will call.
- Html with embedded images or `seed:property/` references is rewritten with Arweave gateway URLs of
  the images' ids, which gives broken links for `ipfs://` ids.

## Pinning providers

A provider receives each file as a CARv1 with one root and pins the root. Pass one or an array; with
several, every provider gets every file and each must succeed. Keys come from your config: the
package has no default provider or key.

**`kuboRpcPinning({ url, headers? })`** uploads to a Kubo node's RPC API with
`POST /api/v0/dag/import?pin-roots=true` and checks pins with `/api/v0/pin/ls`. Use it for your own
node or a host that offers the Kubo RPC; `headers` carries the host's authorization.

**`pinataPinning({ jwt, groupId?, uploadUrl? })`** uploads to Pinata's v3 API
(`https://uploads.pinata.cloud/v3/files`) with `car=true` on the public network. Pinata accepts
CARs only on paid plans and imports them in the background, so it can't report a pin;
`assertStored` asks the gateways instead.

Another service fits the `PinningProvider` interface: `pinCar(car, root)` uploads and pins, and the
optional `isPinned(root)` reports the pin.

## Checking a file is stored

Publish calls `assertStored` before any attestation names a file. It passes once every provider
with `isPinned` reports the pin and, when a provider has no `isPinned`, a gateway answers `HEAD
<gateway>/ipfs/<cid>` with a 2xx. It checks every `pollIntervalMs` (2 s) until `storedTimeoutMs`
(120 s), then throws naming the CIDs still missing.

`gateways` defaults to `DEFAULT_GATEWAYS` (`https://ipfs.io`, `https://dweb.link`). A public gateway
can take minutes to find newly pinned content, so with Pinata list your Pinata gateway first.

## CIDs

Publish needs each file's id before anything is sent, because Html links its images by id before
the Html is uploaded. The store computes the CID from the bytes in `prepare`, with the layout Kubo
uses for

```bash
ipfs add --cid-version=1 --raw-leaves --chunker=size-262144
```

with the balanced layout (no `--trickle`) and at most 174 links per node:

- A file of at most 262144 bytes is a single `raw` block (codec `0x55`). Its CID is the file's
  SHA-256 with a prefix, the same digest as the upload's `Content-SHA-256` tag.
- A larger file is cut into 262144-byte `raw` leaves, grouped left to right into `dag-pb` UnixFS File
  nodes of up to 174 children, level by level, until one root remains. The CID is the root's, codec
  `0x70`.

The tests check these against CIDs and CAR bytes from Kubo 0.21. Newer Kubo releases may change
`ipfs add` defaults, so pass the flags above when reproducing a CID. Pinata's own `cid_version`
setting doesn't apply: a CAR upload keeps the blocks the store built.

`computeCid(bytes)`, `unixFsDag(bytes)` and `toCar(dag)` are exported for tools that build the same
ids outside a publish. A file's DAG holds a copy of its bytes, so a large file is in memory twice
while it is prepared.

## Reading `ipfs://` ids

```ts
import { ipfsGatewayUrls, parseIpfsId } from '@seedprotocol/ipfs'

ipfsGatewayUrls('ipfs://bafkrei…', ['https://example.mypinata.cloud'])
// ['https://example.mypinata.cloud/ipfs/bafkrei…']

parseIpfsId('ipfs://bafkrei…')
// { cid: 'bafkrei…', codec: 'raw', sha256: '…' }
```

`ipfsGatewayUrls(id, gateways = DEFAULT_GATEWAYS)` returns `<gateway>/ipfs/<cid>` for each gateway,
in order, and an empty array for an id that isn't an `ipfs://` CIDv1. `parseIpfsId` gives the
`sha256` of the file's bytes for a `raw` CID; a `dag-pb` root's digest covers the DAG's root node,
not the bytes, so it has none.
