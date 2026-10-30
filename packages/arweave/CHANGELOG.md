# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- New `fetchArweaveRawBytesAcrossGateways(transactionId, options)`: `fetchArweaveRawTextAcrossGateways` without the decoding, for callers that need the transaction's exact bytes.

## 0.8.0 (2026-10-30)

- `probeGateway(url, signal)` from JavaScript throws a `TypeError` naming `{ signal }`. The signal was ignored, so the caller lost its abort and waited out the 5 s timeout.
- `ArweaveTransaction` is the arweave package's `Transaction`, and `createTransaction` (on `BaseArweaveClient`, `IArweaveClient` and the default client) returns `Promise<ArweaveTransaction>`. Both were `any`, so code that read a property `Transaction` doesn't have now fails to type-check. Nothing changed at runtime.

### Commits

#### Fixes

- Atom null fields keep defaults; lookup keeps split; probeGateway refuses a bare signal; changelog wording (624605e5)
- ArweaveTransaction declaration resolves under nodenext (a0819013)

## 0.7.13 (2026-10-29)

- **Breaking:** `probeGateway(baseUrl, { signal, timeoutMs, recordCircuit })` takes an options object; it took the signal as its second argument. It times out after `timeoutMs` (default 5 s) whether or not a `signal` is passed: with a signal it had no timeout. A probe the caller aborts resolves `false` without counting as a failure in the gateway circuit breaker. It counted, and since one failure opens a host's circuit for 60 s, a caller's own time budget blocked the host (for a relative proxy, the app's own host) from reads and probes. `recordCircuit: false` probes a host whose circuit is open and leaves the breaker as it is, for status checks.
- `resolveSeedGatewayEndpoints` takes `timeoutMs`, a budget for all of one resolve's probes. A probe cut short by it or by `signal` isn't cached: it was cached as unreachable for 3 minutes, so a proxy probe aborted once was skipped until the cache expired. A failed probe is cached for 60 s, a healthy one for 3 minutes as before; both were 3 minutes.
- `ensureReadGatewaySelected(signal)` caches nothing when `signal` aborts before a gateway passes, and returns the last healthy host (else the current one). It cached the aborted probe as "no healthy gateway" for 60 s, so `isReadGatewayKnownHealthy()` returned `false` and later calls skipped probing until the cache expired.
- New `resolveSidecarOrigin(config)`: the local Hyper sidecar's host, port and base URL from `hyper.localSidecarHost` and `hyper.localSidecarPort`, else the defaults.
- `parseArweaveTransactionLink` reads `{base}/<id>` back as a link when `base` is a read base URL with a path prefix, such as an app proxy at `https://app.example/api/seed-gateway`. `rehostArweaveLinksInHtml` writes that form for `/<id>` links, but at 0.7.12 nothing parsed it, so `publishedArweaveLinksInHtml` uploaded such links with the proxy URL, `nextArweaveGatewayUrl` (and `SeedHtml`'s load failover) returned `undefined` for them, and re-hosting left them on the proxy. A base with a path prefix no longer makes `/<id>` on its host's root a link: `https://app.example/<id>` parsed as one at 0.7.12.
- `DEFAULT_ARWEAVE_GATEWAYS` is `arweave.net`, `zigza.xyz`, `ar.seedprotocol.io`. `permagate.io` was second and has been down since at least 2026-10-27 (404 "Application not found" on `/info`, `/raw/<id>` and `/graphql`), so reads, failover (`nextArweaveGatewayUrl`, `SeedHtml`) and status checks went there before `zigza.xyz`. Its `/<id>` links still parse and get re-hosted: it is in the new `KNOWN_ARWEAVE_GATEWAYS`, which `isKnownArweaveGatewayHostname` and `parseArweaveTransactionLink` check.
- `getPublicArweaveBaseUrl` before endpoints resolve uses the read host only when it is a gateway's root. A read host with a path prefix, such as an app proxy at `app.example.com/api/seed-gateway`, gives the env host or `https://arweave.net`, like a loopback sidecar address. It returned the proxy URL, which a publish at that point wrote into Html.
- `ARWEAVE_GRAPHQL_TIMEOUT_MS` is exported from the package entry. The 0.7.12 notes named it, but only the module defined it.
- `fetchTransactionStatusAcrossGateways` has its doc comment in the published `.d.ts` again; at 0.7.12 a private helper's comment sat between them.
- `nextArweaveGatewayUrl` finds the base a URL is on by origin and whole path segments, taking the longest match. With `https://app.example` and `https://app.example/api/seed-gateway` both in the list, a URL on the second moved to the second again instead of the next gateway.

### Commits

#### Fixes

- an aborted read-gateway selection isn't cached as unhealthy (49bbe9b5)
- an aborted gateway probe doesn't open the breaker or cache as down (3f1670e8)
- query, feed: export ARWEAVE_GRAPHQL_TIMEOUT_MS, restore status JSDoc, Node engines follow eas (81587295)
- permagate.io leaves the default read list; public base URL skips a proxy read host (a6678a26)
- parse /<id> links under a read base's path prefix (bad9bd80)

## 0.7.12 (2026-10-27)

- The published `.d.ts` files resolve under `moduleResolution: node16` and `nodenext`: relative imports carry `.js` (or `/index.js`), and the type import of arweave-js's `CreateTransactionInterface` names `arweave/web/common.js`, which nodenext finds (`arweave/web` was TS2307).
- **Breaking:** in `http-gateway` mode with no `uploadApiBaseUrl`, `resolveSeedGatewayEndpoints` resolves `uploadApiBaseUrl` to `''`. It fell back to the gateway's base URL, which with the default host is `https://arweave.net`, where no upload API runs. Set `uploadApiBaseUrl` when your gateway also serves the upload API. Proxy and sidecar modes still upload through the proxy or sidecar.
- In a browser, `hybrid` mode tries the local sidecar only from a loopback page (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`) or with the new `hyper.probeSidecarFromBrowser: true`. From a public page the probe was a public-to-loopback request: a failed request and console error on most visitors' cold start, and, for a visitor running the sidecar, uploads routed through it instead of the app's proxy. `transport: 'hyper'` still uses the sidecar.
- New `hyper.probeProxy` turns the `proxyBaseUrl` health check on or off by itself; it defaults to `probeSidecar`, which turned both off together.
- `DefaultArweaveClient` (and `NodeArweaveClient`) GraphQL requests abort after `ARWEAVE_GRAPHQL_TIMEOUT_MS` (30 s), or when the caller's signal does. They had no limit.
- **Breaking:** `getArweaveUrlForTransaction(id)` returns `{first read gateway}/raw/{id}`, the URL this reader loads from (ADR 0025); it returned `{read host}/{id}`. It is now the only `getArweaveUrlForTransaction`: `@seedprotocol/sdk` and `@seedprotocol/query` re-export it. For URLs that leave this reader (published Html, feeds), use `getPublicArweaveRawUrl`. `resolveSeedRssImageRelationRef` builds media URLs with `getPublicArweaveRawUrl`, so a feed server on a Hyper sidecar no longer emits sidecar URLs.
- `getPublicArweaveBaseUrl` before endpoints resolve uses the read host when it isn't a loopback address (a query or feed server's `arweaveDomain`).
- **Breaking:** `DEFAULT_ARWEAVE_HOST` is `arweave.net` (ADR 0025): the default read host, and the host publish writes into Html links unless `arweaveDomain` names another. `DEFAULT_ARWEAVE_GATEWAYS` is `arweave.net`, `permagate.io`, `zigza.xyz`, `ar.seedprotocol.io`. An app that wants Seed's gateway sets `arweaveDomain: 'ar.seedprotocol.io'`.
- `getArweaveReadGatewayHostsForPrimary` keeps every default gateway after a custom primary. It dropped `ar.seedprotocol.io` then.
- With a Hyper sidecar or app proxy active, `getReadGatewayHostsForConfig` and `getArweaveReadBaseUrls` list the public gateway and the default list after it (as `https://` URLs), so `/raw` reads fall back to them when the sidecar or proxy is down. They listed the sidecar or proxy alone. `fetchTransactionStatusAcrossGateways` still asks only the sidecar or proxy (and preferred gateways) then, since a data item it just accepted isn't on the public gateways yet.
- `getPublicArweaveBaseUrl` before client init resolves endpoints returns the env host or `https://arweave.net` when the read host is a loopback address. It returned the read host, which can be a local sidecar URL that a publish would write into Html. (A proxy read host was still returned until the fix in 0.7.13.) An empty `arweaveDomain` now means the default host; it produced `https:///raw/<id>`.
- New `rehostArweaveLinksInHtml(html, { baseUrls })` (ADR 0025) moves the Arweave links in an Html string onto the first of the reader's read gateways (`getArweaveReadBaseUrls` by default): `ar://<id>`, `/raw/<id>` on any host and any path prefix, and `/<id>` on a known gateway, in `src`, `href`, `poster` and `srcset`. Each link keeps its path form and its path, query and hash after the id; every other byte of the Html is kept. Also new: `parseArweaveTransactionLink`, `buildArweaveTransactionLink`, `nextArweaveGatewayUrl` (the same link on the next gateway, for retrying a failed load), `rewriteHtmlAttributes` and `mapUrlAttribute`. `@seedprotocol/arweave` now depends on `parse5`.

### Commits

#### Breaking

- no gateway fallback for uploadApiBaseUrl; browser hybrid skips the sidecar on public pages; GraphQL timeout (a597cbcc)
- query, sdk, feed: one getArweaveUrlForTransaction; feeds emit public Arweave links (1219b7ec)
- arweave.net is the default host; public fallbacks behind a sidecar or proxy (18eec823)

#### Features

- rehostArweaveLinksInHtml moves Html's Arweave links onto the reader's gateways (2d64ac74)

#### Fixes

- read the page origin through globalThis (no DOM lib) (97cca8a8)

## 0.7.11 (2026-10-24)

- **Breaking:** the deprecated `ArweaveClient` alias is removed from `@seedprotocol/arweave/node`. Use `NodeArweaveClient`.
- `DEFAULT_ARWEAVE_GATEWAYS` no longer lists `arweave.dev` and `g8way.io`. Neither domain resolves on public DNS (checked 2026-10-22 and 2026-10-24), so a read that fell back to them failed at DNS before trying the next gateway. The list is now `ar.seedprotocol.io`, `arweave.net`, `permagate.io`, `zigza.xyz`. Set `ARWEAVE_READ_GATEWAYS` to use others.
- `fetchTransactionStatusAcrossGateways` no longer starts another gateway attempt when the budget left is shorter than that attempt's timeout or `MIN_TRANSACTION_STATUS_ATTEMPT_MS` (1 s, newly exported), whichever is shorter. Before, a timer firing just ahead of the deadline could start a ~1 ms attempt that always timed out and counted against the gateway's circuit. The first gateway is always asked. The deadline is measured with `performance.now()`, so wall-clock adjustments no longer stretch or cut the budget.

### Commits

#### Breaking

- sdk, eas, publish: remove deprecated aliases (4d349091)

#### Fixes

- don't start a status attempt on a sliver of budget (0d22903d)
- drop arweave.dev and g8way.io from the default read gateways (b2262b1d)

## 0.7.10 (2026-10-24)

### Commits

#### Fixes

- build: pin @types/bun to 1.4.3 (0dd3ed34)

## 0.7.9 (2026-10-22)

- New `DefaultArweaveClient`, exported from the root entry: the fetch-based client for Node and browsers. `getTransactionData` reads `/raw` from the preferred read gateways (`setPreferredArweaveReadBaseUrls`) before the configured host, unless the caller asks for undecoded data. arweave-js is loaded on first use (the data fallback and `createTransaction`), so the root entry does not import it. `NodeArweaveClient` extends it, so Node reads try the preferred gateways too.
- New `getPublicArweaveBaseUrl()` and `getPublicArweaveRawUrl(transactionId)`: the public gateway for links written into published content, and `{public gateway}/raw/{id}` on it. The read host can be a local Hyper sidecar or an app proxy that nobody else can reach. Before client init resolves endpoints, they use the read host.

### Commits

#### Breaking

- sdk: use the tier-1 packages' clients and helpers instead of copies (00746953)

#### Features

- DefaultArweaveClient with the preferred-gateway read loop (560cdf0d)

#### Fixes

- publish: write public gateway URLs into published Html (f83bffd9)

## 0.7.8 (2026-10-20)

No user-facing changes; released at the same version as the other packages.

## 0.7.6 (2026-10-17)

### Commits

#### Breaking

- vite: cut seedVitePlugin defaults to what the SDK needs (5312b28d)

#### Fixes

- time out status checks and fall back to other gateways (b6c851f5)

## 0.7.5 (2026-10-17)

### Commits

#### Fixes

- packages: top-level types for legacy resolvers; query main -> Node build (12c51228)

#### Other

- packages: add READMEs for react, vite, arweave, eas (baf86652)
- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

## 0.7.4 (2026-10-15)

### Commits

#### Fixes

- query: throw when clients are registered on another copy of eas/arweave (aec6c2e7)

## 0.7.3 (2026-10-14)

### Commits

#### Features

- one read-side seam for Arweave content (8b84c616)

#### Fixes

- sdk: batch Content-SHA-256 lookups and verify downloaded files (c01e41d5)
- query: use already-registered EAS/Arweave clients instead of loading /node (005e192f)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.8 (2026-10-03)

### Commits

#### Other

- Lots of bug fixes (a3a7f146)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)
- Add Arweave gateway circuit breaker for probe and image fetches. (8f572026)

## 0.6.0 (2026-09-22)

### Commits

#### Features

- mapping: add resolve jobs, URL classifier, and AV media roles (ac9ef29c)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Commits

#### Features

- classify EAS explorer URLs and resolve RSS image refs (cd3ae146)
- prefer proxyBaseUrl as http-proxy gateway path (13775b17)

## 0.5.1 (2026-08-29)

### Commits

#### Features

- honor VITE_ARWEAVE_HOST and primary-aware read fallbacks (974c71b7)
- extract Arweave and gateway helpers into @seedprotocol/arweave (3f9060ed)

#### Other

- replace setPlatformClass with instance + static facade (0bca44b7)
- tier1: consolidate remaining GraphQL queries in eas and arweave (2c64d2f1)

## 0.5.0

Initial release: Arweave gateway client, gateway resolution, mediaRef helpers, and Node platform registration.
