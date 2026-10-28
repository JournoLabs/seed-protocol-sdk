# 0025. Published Html names one gateway; every Seed reader re-hosts its links

- **Status:** Accepted
- **Date:** 2026-10-24
- **Scope:** `@seedprotocol/arweave` (default host, gateway list, link resolver),
  `@seedprotocol/sdk` (Html publish, Html value), `@seedprotocol/publish` (`htmlArweaveRefs`),
  `@seedprotocol/react` (`SeedHtml`), `@seedprotocol/query` (body hydration),
  `@seedprotocol/feed` (documents and media links)

## Context

Before upload, publish replaces each `seed:property/<name>` reference in an Html value, and each
`data:` image under the default `htmlEmbeddedDataUriPolicy: 'materialize'`, with
`getPublicArweaveRawUrl(txId)`: `https://<arweaveDomain>/raw/<id>`
(`helpers/htmlEmbeddedDataUriPublish.ts`, `arweave/src/gateway/publicUrl.ts`). The default domain
is `ar.seedprotocol.io`. Publish also writes the rewritten Html back to the local file.

No reader changes these links afterwards. The SDK's Html value, `SeedHtml` (which only runs the
app's `sanitize`), query's body hydration and feed documents all return the Html as uploaded, so a
link gets none of the read path's gateway fallbacks. When the named gateway is down, every image and
link in the published Html is broken, for every reader, permanently. `ar.seedprotocol.io` failed TLS
on 2026-10-18 and 2026-10-20.

Attestations are not affected: they hold transaction ids, never URLs.

Related problems at 0.7.10:

- Before client init resolves endpoints, `getPublicArweaveBaseUrl` falls back to the read host,
  which can be the Hyper sidecar or an app proxy, so an early publish writes a local URL.
- `arweaveDomain: ''` writes `https:///raw/<id>` (`parseGatewayHost` uses `??`).
- Feed item and media links use `BaseArweaveClient.getBaseUrl()` (`arweave/src/mediaRef.ts`), so a
  feed server on Hyper transport emits sidecar URLs.
- Three exports named `getArweaveUrlForTransaction` build different URLs: sdk `/raw/<id>`, query
  `https://<host>/<id>`, arweave `<baseUrl>/<id>`.

An Html value is read in two places. Seed readers (the four above) can rewrite it before showing
it. Everything else (a browser opening the transaction on a gateway, an archive viewer, an RSS
client) shows it as stored, and only an `https` URL works there.

## Decision

### What publish writes

Publish keeps writing `https://<host>/raw/<id>`. The default host becomes `arweave.net`
(`DEFAULT_ARWEAVE_HOST`); `ar.seedprotocol.io` stays in the read fallback list. `arweaveDomain`
still overrides it.

The host is the resolved public gateway (`getPublicArweaveBaseUrl`). Before endpoints resolve it is
the read host unless that is a loopback (sidecar) address, then the env host or the default; it is
never a sidecar URL. An empty `arweaveDomain` means the default host instead of producing
`https:///…`.

Publish also rewrites every Arweave link already in an Html value it uploads into the published
form: a link a reader re-hosted onto a sidecar, a proxy or another gateway, and an editor saved
back, goes up on the public gateway. Html already published is left as it is.

A publish option, `htmlArweaveRefs: 'ar'`, writes `ar://<id>` instead. It is for apps whose
Html is only ever shown by a Seed reader; anywhere else those links don't load. The default is
`'gateway'`.

### One resolver for every reader

`@seedprotocol/arweave` gets one function that rewrites the Arweave links in an Html string onto the
reader's gateway list:

- It reads `src`, `href`, `srcset` and `poster` attributes only, and leaves all other markup as it
  is.
- It recognises `ar://<id>`, `https?://<host>/raw/<id>` on any host, and
  `https?://<host>/<id>` on a known gateway: the configured read list, the default list, and
  `isKnownArweaveGatewayHostname`. `<id>` is a 43-character base64url transaction id. `/raw/` is
  specific to Arweave gateways, so it is matched on any host; a bare `/<id>` path is too common to
  match on unknown hosts. A read-list base URL with a path prefix (an app proxy such as
  `https://app.example/api/seed-gateway`) is matched as `{base}/<id>`, and only there: other paths
  on its host are not links. (Amended 2026-10-27; at 0.7.12 those links did not parse, so publish
  uploaded them with the proxy URL.)
- It keeps the path form it found: `/raw/<id>` stays `/raw/<id>`, `/<id>` stays `/<id>`. Gateways
  treat them differently (`/raw/` skips manifest resolution; `arweave.net` redirects `/<id>` to a
  sandbox subdomain). `ar://<id>` becomes `/raw/<id>`.
- The new host is the first entry of the reader's read gateway list. In Hyper or proxy mode that is
  the sidecar or proxy, which serves this reader and nobody else, so it is never written back to
  the stored Html.

The reader's read list continues with the public gateway and the default list (`arweave.net`,
`permagate.io`, `zigza.xyz`, `ar.seedprotocol.io`) after any sidecar or proxy, unless the app
replaces the list (`ARWEAVE_READ_GATEWAYS`). Transaction status checks still ask only the sidecar or
proxy while one is active: a data item it just accepted isn't on the public gateways yet, and their
404 would read as missing.

Readers apply it as follows:

- **SDK Html value** (`resolveStorageDisplay`): rewrites on read, so editors that show the value
  get working images too. The stored file keeps the links as written; `exportArchive` reads with
  `rehostLinks: false`, so a bag keeps each Html as published.
- **Query** (`hydrateArweaveRichText.ts`): rewrites hydrated bodies, and fetches the body itself
  across the gateway list instead of one URL.
- **`SeedHtml`**: rewrites before calling the app's `sanitize`, so a sanitizer that drops unknown
  URL schemes never sees `ar://`. After render it listens on its container, in the capture phase,
  for `error` events from `img`, `video`, `audio` and `source`, and moves that element to the next
  host in the list. This needs no script inside the Html. With the `render` prop the app owns the
  container, so `SeedHtml` exports the same listener as a helper the app attaches.
- **Feed**: media links, link fields and Html fields use the feed's public host (`arweaveDomain`,
  default `arweave.net`), never the read host, since RSS clients outside Seed read them. Query hands
  feed this reader's URLs, so feed rewrites them back.

String readers can only pick one host per link; failover after a load error happens only in
`SeedHtml` (or an app using its helper).

Two functions name the two audiences. `getArweaveUrlForTransaction(id)` is the URL this reader loads
from, `{first read gateway}/raw/{id}`; it is the only one, in `@seedprotocol/arweave`, and the SDK's
and query's copies are removed. `getPublicArweaveRawUrl(id)` is the URL for anything that leaves
this reader: published Html and feeds.

## Consequences

- Html published before this change is repaired for Seed readers without republishing: its
  `ar.seedprotocol.io/raw/<id>` links are re-hosted like any other.
- Viewers outside Seed still depend on one gateway, now `arweave.net` by default. That is the
  remaining single point of failure, and it can't be removed while the Html has to work without a
  Seed reader.
- **Breaking:** new publishes and default reads move from `ar.seedprotocol.io` to `arweave.net`. An
  app that wants Seed's gateway sets `arweaveDomain`. The three `getArweaveUrlForTransaction`
  exports become one, returning `/raw/<id>` on the reader's first gateway (query's returned
  `/<id>`).
- The resolver runs on every Html read. It parses attributes, not the whole document; its cost
  should be checked against PermaPress's listing timings.
- A link to a different Arweave app's `/raw/<id>` on some other host is re-hosted too. The content
  is the same transaction, so the result is equivalent.
- Local Html after publish holds gateway URLs where it had `data:` images or `seed:property/`
  references. Offline, those images don't load even though the image seeds are on disk. The resolver
  could map a transaction id to a local file first; that is left for later.
- The docs' interim advice (set `arweaveDomain` to a long-running gateway, rewrite `/raw/` hosts in
  `sanitize`) becomes unnecessary for Seed readers.

## Alternatives considered

- **Write `ar://<id>` by default.** Host-free, but broken everywhere outside a Seed reader, and Seed
  readers gain nothing over re-hosting `https` links. Kept as an opt-in.
- **Keep `seed:property/<name>` in the uploaded Html.** Broken outside Seed, and resolving it needs
  the Seed's attestations, which ties the Html to Seed's data model.
- **Two URLs per link** (`srcset`, `<picture>`, or a `data-ar-id` attribute). HTML has no
  failover between sources: `srcset` and `<picture>` select one by size, media or type and never
  retry. A `data-ar-id` attribute repeats what the `/raw/<id>` path already carries.
- **An inline `onerror` in the Html.** App sanitizers strip event handlers, and the stored Html
  would carry script.
- **Re-host only known gateways.** Links written with a custom `arweaveDomain` would not be
  repaired. `/raw/<id>` is distinctive enough to match on any host.
