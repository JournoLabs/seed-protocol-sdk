# @seedprotocol/query

Canonical **Seed JSON** reads from remote EAS or a registered local SQLite/files adapter (Seed → Version → property attestations).

Feed generation (`@seedprotocol/feed`) uses this package to assemble items; RSS/Atom/JSON Feed formatting and **HTTP / serialized content** caching stay in feed.

SDK `runSyncFromEas` / `syncDbWithEas` persists the same EAS graph into SQLite using shared **`parseEasPropertyMetadata`**, **`parseEasRelationPropertyName`**, and **`pickLatestPropertyAttestationsByRefAndSchema`** — one definition of property decode/canonicalization for reads and sync writes.

## Scope

- `getSeed(seedUid)` — one seed’s canonical JSON envelope, optional **changelog**
- `queryBySchema(schemaName, { limit, skip })` — paginated collection (latest-only)
- `queryBySchemaForMonth` — calendar-month listing (used by feed archives)
- Resolve mode: **latest Version**, then newest property attestation per `(version, schemaId)`
- **`source: 'local' | 'remote' | 'auto'`** — pluggable backends (default `'remote'`)
- **Shared collection + item cache** for **remote** reads (memory → disk)

### Published vs authoring

| Need | Use |
|------|-----|
| Published / canonical Seed JSON | `getSeed` / `queryBySchema` / SDK `getPublishedSeedRecord` |
| Drafts, edits, liveQuery, publish | SDK `Item` / `getItemData` (local-head) |
| Populate local DB from EAS | SDK `Client.syncFromEas` / `runSyncFromEas` (shared parse + pickLatest) |

The Query API conversion (remote assemble → cache → changelog → local source → sync consolidation) is **complete**. Optional follow-ons (HTTP JSON routes, `auto` freshness TTL) are outside this package’s core read surface.

## Usage

```ts
import {
  initializeQueryPlatform,
  getSeed,
  queryBySchema,
} from '@seedprotocol/query'

await initializeQueryPlatform({ arweaveDomain: 'ar.seedprotocol.io' })

const one = await getSeed('0x...')
console.log(JSON.stringify(one?.data, null, 2))

const { items, limit, skip, etag } = await queryBySchema('post', {
  limit: 20,
  skip: 0,
})
```

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

Options on both APIs: `expandRelations` (default `true`), `hydrateStorage` (default `true`), `cache` (default: follow env; pass `false` to bypass), `source` (default `'remote'`).

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
| `CACHE_TTL` | `3600` | Seconds for collection + item entries |
| `CACHE_DIR` | `./cache` | Collections: `{schema}.json`; items: `items/{seedUid}-{opts}.json` |

Behavior:

- **Collection cache** — only for **remote** `queryBySchema` with `skip === 0` (working set). Warm hits still fetch the page to detect newer `timeCreated`, then merge/dedupe.
- **Item cache** — keyed by `seedUid` + options fingerprint (`expandRelations` / `hydrateStorage` / `include` / changelog filters). Default latest-only key remains `e1-h1`. Filled by remote `getSeed` and write-through from collection/month queries.
- **`cache: false`** — skip all cache reads/writes for that call.
- **`skip > 0`** — no collection cache; still write-through items when cache is enabled.
- **Local source** — no query CacheManager (SQLite is authoritative).
- Refresh lock — concurrent remote `queryBySchema` for the same schema share one in-flight refresh.

Feed still owns serialized RSS/Atom/JSON bodies, HTTP `ETag` / 304, and image-metadata probing.

## Init

Call `initializeQueryPlatform()` once (registers Node EAS + Arweave clients), or rely on `getSeed` / `queryBySchema` which initialize automatically.

For local reads, also ensure the SDK client has initialized (registers `registerLocalQuerySource`) or call `registerSeedQueryLocalSource()` / `registerLocalQuerySource` yourself.
