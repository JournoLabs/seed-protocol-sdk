# Changelog

All notable changes to this package are documented in this file.

## 0.7.10 (2026-10-24)

- `serveTunnel` takes `allowlist: { keys, ips }` and `seed-gateway serve` takes
  `--allow-keys` and `--allow-ips`. A client whose public key or address (IP or CIDR) is
  listed is let in; with neither list set, every client is, as before. Invalid entries throw
  at startup. See "Restricting who can connect" in docs/GATEWAY_HYPER.md for which address
  is checked and why LAN clients show their LAN address.
- `connectTunnel`, `createTunnelSession` and `createGatewayProxy` take `keyFile` or
  `keyPair` for the key the client presents, so it can go on a key allowlist. The default is
  still a new key per run. `TunnelSession` and `connectTunnel`'s result expose `clientKey`.
  `seed-gateway connect` takes `--key-file` and `--print-key`.
- Every DHT entry point takes `bootstrap` nodes, for a private or local HyperDHT network.
- `serveTunnel` takes `onEvent`, called with a `TunnelEvent` for each stream and each step of a
  request, and `requestIdHeader`, which sends each request's id upstream (replacing any value
  the client sent). `seed-gateway serve` takes `--trace` and `--request-id-header`.
  `upstreamRequestHeaders` is exported.
- Raw TCP mode: `serveRawTunnel` and `connectRawTunnel`, and `seed-gateway serve --raw` and
  `connect --raw`. Each TCP connection gets its own HyperDHT stream, piped byte for byte to the
  upstream, so HTTP runs end to end with no size limit. A raw server needs its own key. See
  ADR 0024 and "Raw TCP mode" in docs/GATEWAY_HYPER.md.
- `seed-gateway connect` takes `--connect-timeout-ms`, and `--port 0` picks a free port instead
  of falling back to 1984.

### Commits

#### Features

- raw TCP tunnel mode (2aa0c031)
- serveTunnel events and per-request id header (188a3075)
- connection allowlist for serveTunnel (477bbabb)
- persistent client keys for connectTunnel and createGatewayProxy (5655b04e)
- bootstrap option for private or local HyperDHT networks (60a343c2)

#### Fixes

- build: pin @types/bun to 1.4.3 (0dd3ed34)

#### Other

- ADR 0024 raw TCP mode; tracing and raw mode runbook (87cd7e95)
- allowlist and client key runbook, changelog notes (9023086f)

## 0.7.6 (2026-10-17)

A request the operator's upstream never answers no longer blocks the tunnel for good.

- A tunnel session sends requests over up to `maxStreams` HyperDHT streams to the operator
  (default 4), one request per stream at a time, so a slow request no longer holds up the
  rest. `createGatewayProxy` and `connectTunnel` take `maxStreams`; `seed-gateway connect`
  takes `--max-streams`. The wire protocol is unchanged and works with operators already
  deployed, which now see up to `maxStreams` connections and concurrent upstream requests
  from each client.
- The client abandons a request once the stream has been idle for `requestTimeoutMs`
  (default 60 s), answers 504, and destroys that request's stream. The stream reopens for
  the next request that takes it.
  `createGatewayProxy` and `connectTunnel` take `requestTimeoutMs` and `connectTimeoutMs`;
  `seed-gateway connect` takes `--request-timeout-ms`.
- `forwardHttp` and `runOnTunnel` take `{ signal, timeoutMs }`. `handleFetch` passes
  `request.signal`, and `handleNode` and the sidecar abort when the caller disconnects.
- The operator answers 504 once its upstream socket has been idle for `upstreamTimeoutMs`
  (default 30 s; `seed-gateway serve --upstream-timeout-ms`), and 502 for other upstream
  failures, instead of holding or dropping the stream.
- Responses larger than 16 MiB (up to the 64 MiB frame limit) are sent in 1 MiB writes.
  Before, secret-stream rejected them and the stream was torn down.
- The operator no longer forwards hop-by-hop request headers or the client's `Host`. The
  upstream sees its own host, with the original in `X-Forwarded-Host`. Check any upstream
  routing rule that matched on the forwarded `Host`.

### Commits

#### Features

- pool tunnel streams so a slow request stalls only its own (48f974dd)

#### Fixes

- time out and abandon stuck tunnel requests (4ef38f89)

## 0.7.5 (2026-10-17)

### Commits

#### Fixes

- packages: top-level types for legacy resolvers; query main -> Node build (12c51228)

#### Other

- packages: audit feed, feed-hyper, gateway-hyper, mapping, publish, query READMEs (1a5d7ee4)
- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

## 0.7.1 (2026-10-10)

### Commits

#### Features

- feed-hyper: ship seed-feed and seed-gateway bins (aca397d2)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Commits

#### Features

- add createGatewayProxy for app-server Path B (9d8d18a6)

## 0.5.1 (2026-08-29)

### Commits

#### Features

- add Hyper tunnel serve and connect package (98ca591f)
