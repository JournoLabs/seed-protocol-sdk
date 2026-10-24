# 0024. gateway-hyper carries raw TCP as a second protocol, on its own key

- **Status:** Accepted
- **Date:** 2026-10-23
- **Scope:** `@seedprotocol/gateway-hyper` (`serveRawTunnel`, `connectRawTunnel`,
  `seed-gateway serve --raw` and `connect --raw`)

## Context

The tunnel `serveTunnel` and `connectTunnel` speak frames a whole HTTP request or response
at a time. A frame is capped at 64 MiB, each HyperDHT stream carries one request at a time
(up to `maxStreams`, 4 by default), and `upgrade` is dropped, so WebSockets can't pass. That
fits the SDK sidecar, whose requests are gateway reads and upload API calls.

An operator can put an HTTP reverse proxy in front of the tunnel to serve a public gateway
hostname. That traffic includes large uploads and downloads, `Range` reads and many concurrent
connections, which the framed tunnel can't carry. A raw TCP tunnel carries it, and it belongs in
the package, beside the allowlist and client keys it depends on.

`hypertele` (bitfinexcom, a TCP proxy over HyperDHT) does the piping, but only allowlists by
key, has no events, no library API, and its own seed-based key format.

## Decision

The package has a second protocol, raw mode. `connectRawTunnel` listens on a local TCP port
and opens one HyperDHT stream per accepted connection; `serveRawTunnel` pipes each stream byte
for byte to a new TCP connection to its upstream. There is no framing, so HTTP/1.1 (or anything
else over TCP) runs end to end between the client in front and the upstream.

- A raw server listens on its own key (default file
  `.seed/gateway-tunnel/raw-operator.key.json`). Framed and raw clients can't talk to the other
  kind of server, and nothing on the wire tells them apart.
- Both ends use the same allowlist, client key files and event style as the framed tunnel.
- HyperDHT → TCP is forwarded by hand with backpressure. streamx's `pipe()` destroys its
  source with `PREMATURE_CLOSE` when the destination closes first, which the far end sees as a
  reset.
- Half-closes pass through: both TCP ends are created with `allowHalfOpen: true`. When one side
  closes cleanly, the other is ended and destroyed only after a 30 s grace period; after an
  error, it is destroyed at once.
- The client destroys a stream that hasn't opened within `connectTimeoutMs` (default 30 s,
  as in framed mode) and refuses connections beyond `maxConnections` (default 64).

The SDK sidecar and `createGatewayProxy` stay on the framed protocol. Moving them onto raw mode
would remove their size and concurrency limits but changes what every deployed client and
operator speaks, so it is a separate decision.

## Consequences

- Operators who front the tunnel with an HTTP proxy get keep-alive, streaming, `Range` and
  WebSockets with no size cap.
- Each raw connection costs a DHT lookup and handshake, so the client in front must keep
  connections alive, e.g. nginx `keepalive`.
- An operator serving both protocols runs two HyperDHT servers and publishes two keys.
- Two protocols to maintain. The raw one is small (a byte pipe), but its close and half-close
  handling is where bugs live: without `allowHalfOpen`, a client that half-closes after its
  request loses the response.
- The operator sees bytes, not requests, so raw-mode events are per connection (`conn.open`,
  `conn.close` with byte counts), not per request.

## Alternatives considered

- **Use `hypertele`.** No IP allowlist, events or library API, and a different key format
  from the rest of the package.
- **Raise the framed protocol's limits** (streamed frames, request ids, multiplexing). That is
  most of HTTP/2 rebuilt, and still wouldn't carry WebSockets without more work.
- **One key for both protocols, telling them apart by a first-byte marker.** Raw mode would no
  longer be a transparent byte pipe, and a framed client of an old operator would still fail.
- **Leave raw mode to each operator.** Every copy would drift from the package's allowlist
  and key handling.
