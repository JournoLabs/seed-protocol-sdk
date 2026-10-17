# Changelog

All notable changes to this package are documented in this file.

## Unreleased

A request the operator's upstream never answers no longer blocks the tunnel for good.

- The client abandons a request once the stream has been idle for `requestTimeoutMs`
  (default 60 s), answers 504, destroys the stream and reconnects for the next request.
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
  upstream sees its own host, with the original in `X-Forwarded-Host`. Check any Traefik
  rule that matched on the forwarded `Host`.

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
