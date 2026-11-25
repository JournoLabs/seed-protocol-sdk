# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- `ipfsMirror` takes `required` (default `true`) and `onPinResult` (new types `IpfsMirrorOptions` and `PinResult`). With `required: false`, a failed pin upload or a CID not confirmed within `storedTimeoutMs` no longer fails the publish; the wrapped store's failures still do. `onPinResult({ id, cid, ok, error })` is called once per upload with the attested id and its CID: from `send` when the pin upload fails, else from `assertStored`. With `required: false`, the uploads after a failed one are still pinned; with `true`, `send` still stops at the first failure.

## 0.8.3 (2026-11-23)

- New package. `ipfsBlobStore(options)` is a `BlobStore` for `PublishConfig.blobStore` whose ids are `ipfs://<cidv1>`, computed in `prepare` from each upload's bytes. `send` uploads each file as a CARv1 to every pinning provider; `assertStored` waits until each provider with `isPinned` reports the pin, or a gateway answers `HEAD /ipfs/<cid>`, for up to `storedTimeoutMs` (120 s).
- `ipfsMirror(store, options)` attests `store`'s ids and also pins every upload to IPFS. Each upload reaches `store` with an `IPFS-CID` tag naming its CID, and a pin that doesn't land fails the publish.
- CIDs follow Kubo's `ipfs add --cid-version=1 --raw-leaves --chunker=size-262144` with the balanced layout and 174 links per node: a file of at most 262144 bytes is one `raw` block whose CID is its SHA-256, a larger one a `dag-pb` UnixFS DAG. `computeCid`, `unixFsDag` and `toCar` are exported.
- Pinning providers: `kuboRpcPinning({ url, headers })` (Kubo RPC `dag/import` and `pin/ls`) and `pinataPinning({ jwt, groupId })` (Pinata v3 upload with `car=true`). Other services implement `PinningProvider`.
- `ipfsGatewayUrls(id, gateways)` turns an `ipfs://` id into `<gateway>/ipfs/<cid>` URLs, and `parseIpfsId(id)` returns the CID, its codec and, for a `raw` CID, the file's SHA-256.
- `ipfsBlobSource({ gateways })` reads `ipfs://` ids in the SDK (`SeedConfig.blobSources`): the key is the CID, the URLs are `<gateway>/ipfs/<cid>` in order, and `sha256` is the file's SHA-256 for a `raw` CID (none for a `dag-pb` root).
