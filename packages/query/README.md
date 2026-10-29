# @seedprotocol/query

[![npm](https://img.shields.io/npm/v/@seedprotocol/query.svg)](https://www.npmjs.com/package/@seedprotocol/query)

Canonical **Seed JSON** reads from remote EAS or a registered local SQLite/files adapter (Seed → Version → property attestations). Part of [Seed Protocol](https://seedprotocol.io); works standalone or alongside [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk).

Feed generation (`@seedprotocol/feed`) uses this package to assemble items; RSS/Atom/JSON Feed formatting and **HTTP / serialized content** caching stay in feed.

SDK EAS sync (`client.syncFromEas()`) persists the same EAS graph into SQLite using shared **`parseEasPropertyMetadata`**, **`parseEasRelationPropertyName`**, and **`pickLatestPropertyAttestationsByRefAndSchema`** — one definition of property decode/canonicalization for reads and sync writes.

## Scope

- `getSeed(seedUid)` — one seed’s canonical JSON envelope, optional **changelog**, at its latest version or a pinned one
- `getSeeds(seedUids)` — many seeds of any schemas in one set of requests, keyed by UID
- `queryBySchema(schemaName, { limit, skip })` — paginated collection (latest-only)
- `queryBySchemaForMonth` — calendar-month listing in UTC (used by feed archives)
- Resolve mode: **latest Version** (or a pinned one), then newest property attestation per `(version, schemaId)`
- **`source: 'local' | 'remote' | 'auto'`** — pluggable backends (default `'remote'`)
- **Shared collection + item cache** for **remote** reads (memory → disk)

### Published vs authoring

| Need | Use |
|------|-----|
| Published / canonical Seed JSON | `getSeed` / `queryBySchema` / SDK `getPublishedSeedRecord` |
| Drafts, edits, liveQuery, publish | SDK `Item` (`Item.find` / `Item.all`, local-head) |
| Populate local DB from EAS | SDK `client.syncFromEas()` (shared parse + pickLatest) |

The Query API conversion (remote assemble → cache → changelog → local source → sync consolidation) is **complete**. Optional follow-ons (HTTP JSON routes, `auto` freshness TTL) are outside this package’s core read surface.

## Installation

```bash
npm install @seedprotocol/query
```

No peer dependencies. The package root resolves to a browser build under the `browser` condition and to a Node build (with the on-disk `FileCache`) otherwise; `@seedprotocol/query/node` exposes the Node-only init and `FileCache` explicitly.

## Usage

```ts
import {
  initializeQueryPlatform,
  getSeed,
  queryBySchema,
} from '@seedprotocol/query'

await initializeQueryPlatform({ arweaveDomain: 'arweave.net' })

const one = await getSeed('0x...')
console.log(JSON.stringify(one?.data, null, 2))

const { items, limit, skip, etag } = await queryBySchema('post', {
  limit: 20,
  skip: 0,
})

// Seeds whose UID starts with a prefix (e.g. the 8-hex-digit trunc in a URL), newest first
const { items: matches } = await queryBySchema('post', { uidPrefix: 'fd8c50ca', limit: 16 })

// Seeds attested by one of these addresses, newest first
const { items: owned } = await queryBySchema('publication', {
  attesters: ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', walletAddress],
  limit: 100,
})
```

`uidPrefix` takes at least 4 hex digits, with or without `0x`, in any case (it is lowercased: EAS matches UIDs case-sensitively); anything else returns no items. It filters like a schema listing (schema name, not revoked, seeds whose versions were all revoked left out) in one EAS request, or a `LIKE` on the local source. It never reads or writes the collection cache; matched items are written through to the item cache. `normalizeUidPrefix` is exported for callers that want the same validation.

`attesters` keeps seeds whose Seed attestation (`SeedRecord.attester`) was made by one of the addresses, in any case, with or without `0x`. It applies before `limit` and `skip`, so a page holds that many of those attesters' seeds: on the remote source it is an `attester: { in: [...] }` condition in the EAS request, with each address checksummed (EAS compares attesters case-sensitively in checksummed form). Entries that aren't 20-byte hex addresses are ignored; an empty list, or one with no address in it, returns no items without a request. It combines with `uidPrefix`, and like it never reads or writes the collection cache; matched items are written through to the item cache. `normalizeAttesters` is exported.

`SeedRecord` shape:

```ts
{
  seedUid: string
  schemaName: string
  attester?: string
  timeCreated: number
  versionUid: string
  data: Record<string, unknown>  // canonical property map + relations
}
```

Options on every API: `relations` (default `'expand'`), `hydrateStorage` (default `true`), `cache` (default: follow env; pass `false` to bypass), `source` (default `'remote'`).

`relations` sets how relation properties come back. `'expand'` resolves Html/File relations to Arweave URLs and nests other related seeds as objects. `'uids'` leaves every relation as a seed UID and fetches no related seeds, so a listing makes three indexer requests (seeds, versions, properties) instead of up to seven; `hydrateStorage` still reads the requested seeds' own storage fields.

In every mode a relation is returned under its schema key, worked out from its EAS name: `author_id` becomes `author`, and a list's `author_identity_ids` becomes `authors`. A list's EAS name is the singular key plus the related model plus `Ids`, so whether the key was plural is lost; the key returned is always the plural (`featured_portfolio_clip_ids` comes back as `featureds`).

## Many seeds (`getSeeds`)

```ts
const clips = await getSeeds(clipUids, { hydrateStorage: false })
// Map<string, SeedRecord>, keyed by each UID as given, in order
```

Seeds may be of different schemas; each record's `schemaName` is its own. Seeds that aren't found, are revoked, or lack their pinned version are left out of the map. UIDs are read lowercase and deduplicated in any case; the map keeps the first spelling of each.

The seeds not in the cache are assembled together, so the number of indexer requests doesn't grow with the number of seeds: seeds, versions and properties, then the same for related seeds, plus storage bodies when `hydrateStorage` is on. Cached seeds are checked for changes in one request. Records share the item cache with `getSeed` under the same options. With `source: 'auto'`, seeds the local source doesn't have are read from remote. There's no changelog option.

## One version (`versionUid`, `asOf`)

```ts
// The version a clip pins, as it was when the clip was made
const post = await getSeed(postUid, { versionUid: pinnedVersionUid, asOf: clip.timeCreated })

// Several, in one call
const posts = await getSeeds(postUids, {
  pins: new Map([[postUid, { versionUid: pinnedVersionUid, asOf: clip.timeCreated }]]),
})
```

`versionUid` names one of the seed's live versions by its attester; it returns null (or no map entry) when the seed has no such version. A `patch` publish adds property attestations to the seed's current version instead of making a new one, so a version uid alone shows later patches to that version. `asOf` (unix seconds) leaves out attestations made after it, so the read shows the version as it was then; with `asOf` alone, the seed's newest version created by then is read. Relations, storage and attester filtering work as for the latest version, and related seeds are assembled at their latest version. With `include: 'data+changelog'`, `data` is the pinned version and the changelog still covers every version. See [ADR 0011](../../docs/adr/0011-reading-a-seed-at-a-version.md).

## Source (`local` / `remote` / `auto`)

| `source` | Behavior |
|----------|----------|
| `'remote'` (default) | EAS GraphQL + Arweave hydrate; uses query CacheManager when enabled |
| `'local'` | Requires `registerLocalQuerySource(...)` (SDK registers on client init). Published SQLite snapshot only — not drafts |
| `'auto'` | Prefer registered local when the seed/collection resolves; otherwise remote. No sync refresh / freshness TTL |

```ts
import {
  registerLocalQuerySource,
  getSeed,
  type QueryDataSource,
} from '@seedprotocol/query'

// SDK apps: Client.init registers automatically via registerSeedQueryLocalSource().
// Or register a custom adapter:
registerLocalQuerySource(myLocalSource)

const local = await getSeed('0x...', { source: 'local' })
const either = await getSeed('0x...', { source: 'auto' })
```

Unresolved `source: 'local'` without a registered adapter throws. Local / resolved-local `auto` **bypasses** the query disk/memory cache (SQLite is the store).

From `@seedprotocol/sdk`:

```ts
import { getPublishedSeedRecord } from '@seedprotocol/sdk'

const published = await getPublishedSeedRecord('0x...', { source: 'local' })
```

Authoring UIs keep using `Item` / liveQuery for drafts; published JSON snapshots use query + `source`.

## Changelog (`getSeed` only)

```ts
const withHistory = await getSeed('0x...', {
  include: 'data+changelog', // 'data' | 'data+changelog' | 'changelog'
  changelog: {
    granularity: 'version', // or 'property'
    since: 1700000000,      // optional unix seconds
    limit: 20,              // optional; keeps newest N after since
  },
})
// withHistory.changelog?: ChangelogEntry[]
```

- **`include: 'data'`** (default) — same as before; no `changelog` field.
- **`include: 'data+changelog'`** — latest assembled `data` (expand/hydrate apply) plus history.
- **`include: 'changelog'`** — envelope + `changelog`; `data` is `{}`.
- **Version granularity** (default) — consecutive flat Version snapshots with `before` / `after` / `changedKeys`.
- **Property granularity** — one entry per property attestation change (`previousValue` / `nextValue`).
- Historical snapshots are **flat** (no relation expand / Arweave hydrate). Collections stay latest-only.
- Works for `source: 'local'` when versions + attested metadata exist in the DB.

## Caching

Controlled by the same env vars as feed content cache (ops compatibility):

| Variable | Default | Notes |
|----------|---------|--------|
| `CACHE_ENABLED` | on in prod; **off** when `NODE_ENV=development` | Set `true`/`false` to force |
| `CACHE_TTL` | `3600` | Seconds from an entry's last full assembly until it is rebuilt from scratch |
| `CACHE_MAX_AGE` | `0` | Seconds after a collection was last checked during which `queryBySchema` returns it with no request; per call, `maxAge` |
| `CACHE_DIR` | `./cache` | Collections: `collections/{schema}.{opts}.json`; items: `items/{seedUid}-{opts}.json` |

Behavior:

- **Change checks** — every cache hit asks EAS, in one request, for attestations created or revoked since the entry was last checked that touch what it was built from: the seed, its head Version, and the seeds it relates to (and their head Versions). New Versions, property edits on the same Version (the default `patch` publish), and revocations are all seen. Only changed seeds are assembled again; a cached seed that was revoked drops out. The TTL is a backstop for anything a check can't see (e.g. relations of related seeds).
- **Collection cache** — only for **remote** `queryBySchema` with `skip === 0`, per schema and options fingerprint. Each hit fetches the seed list (shows new and revoked seeds) and, in the same round, checks every cached seed for changes; then it assembles only new or changed ones.
- **`maxAge`** — off by default. With `maxAge: 60` (or `CACHE_MAX_AGE=60`), a collection checked less than 60 seconds ago in this process is returned with no request, so new, changed and revoked seeds show up to 60 seconds late. The time is kept in memory per schema, options and `limit`.
- **Item cache** — keyed by `seedUid` + options fingerprint (`relations` / `hydrateStorage` / `include` / changelog filters / `versionUid` / `asOf`). Default latest-only key is `e3-h1`; `relations` maps to `e3` (`'expand'`) and `e5` (`'uids'`). Filled by remote `getSeed` and `getSeeds` and write-through from collection/month queries; a `getSeed` or `getSeeds` hit is checked for changes first.
- **ETags** — from content, so they change with any edit (not only a new `versionUid`).
- **Arweave bodies** — cached in memory by transaction id (their content never changes), whether or not the query cache is enabled.
- **Read-only results** — records from a cached read are the cache's own objects, shared with every later caller, so `SeedRecord` is typed read-only (`data: SeedData`, `changelog: readonly ChangelogEntry[]`). Outside `NODE_ENV=production`, records are also deep-frozen as they enter the memory cache (stored, or loaded from disk), so a write throws a `TypeError` instead of silently changing what later callers see and leaving the ETag stale. Production skips the freeze. Copy before changing anything, nested values included (copy-on-write, as feed's `applyFeedDefaultsDeep` does). `queryBySchema`'s `items` array is the caller's own. Set `freezeRecords` on the cache config to override.
- **`cache: false`** — skip all cache reads/writes for that call.
- **`skip > 0`** — no collection cache; still write-through items when cache is enabled.
- **Local source** — no query CacheManager (SQLite is authoritative).
- Refresh lock — concurrent remote `queryBySchema` calls for the same schema, options and `limit` share one in-flight refresh.

Feed still owns serialized RSS/Atom/JSON bodies, HTTP `ETag` / 304, and image-metadata probing.

## Init

Call `initializeQueryPlatform()` once, or rely on `getSeed` / `getSeeds` / `queryBySchema` which initialize automatically.

Init only fills in what is missing. EAS and Arweave clients that are already registered, such as SeedClient's in a page or process running the SDK, are used as they are, along with the SDK's chain and Arweave gateway. So query can run beside SeedClient without replacing its clients.

- **EAS:** registers the default fetch-based EAS and query clients (`ensureEasPlatform()` from `@seedprotocol/eas`) when none are registered.
- **Arweave:** with no Arweave client registered, the Node entry registers the Node client. The browser entry only sets the read gateway, because query only needs the host. It never loads `@seedprotocol/eas/node` or `@seedprotocol/arweave/node`.
- **`arweaveDomain`:** when passed, it always sets the gateway host.
- **One copy of each package:** if the clients were registered on another copy of `@seedprotocol/eas` or `@seedprotocol/arweave`, for example a second install or a separate Vite pre-bundle, every query call throws `DuplicateEasModuleError` or `DuplicateArweaveModuleError`. It doesn't quietly use other clients and another chain. To fix it, install every `@seedprotocol/*` package at the same version and only once (`npm ls @seedprotocol/eas`). With Vite, `seedVitePlugin` pre-bundles eas, arweave and query together.

`source: 'remote'` (the default) always reads EAS, even when a local source is registered.

For local reads, also ensure the SDK client has initialized (registers `registerLocalQuerySource`) or call `registerSeedQueryLocalSource()` / `registerLocalQuerySource` yourself.

## License

MIT
