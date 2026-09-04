# @seedprotocol/query

Canonical **Seed JSON** reads from remote EAS (Seed → Version → property attestations).

Feed generation (`@seedprotocol/feed`) uses this package to assemble items; RSS/Atom/JSON Feed formatting and **HTTP / serialized content** caching stay in feed.

## Scope

- **Remote-only** assembly (EAS GraphQL + Arweave gateway hydration)
- `getSeed(seedUid)` — one seed’s canonical JSON envelope, optional **changelog**
- `queryBySchema(schemaName, { limit, skip })` — paginated collection (latest-only)
- `queryBySchemaForMonth` — calendar-month listing (used by feed archives)
- Resolve mode: **latest Version**, then newest property attestation per `(version, schemaId)`
- **Shared collection + item cache** (memory → disk), with the same TTL / incremental-merge / refresh-lock patterns feed used for item lists

Later phases: `source: 'local' | 'remote' | 'auto'`, SDK sync consolidation.

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

Options on both APIs: `expandRelations` (default `true`), `hydrateStorage` (default `true`), `cache` (default: follow env; pass `false` to bypass).

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

## Caching

Controlled by the same env vars as feed content cache (ops compatibility):

| Variable | Default | Notes |
|----------|---------|--------|
| `CACHE_ENABLED` | on in prod; **off** when `NODE_ENV=development` | Set `true`/`false` to force |
| `CACHE_TTL` | `3600` | Seconds for collection + item entries |
| `CACHE_DIR` | `./cache` | Collections: `{schema}.json`; items: `items/{seedUid}-{opts}.json` |

Behavior:

- **Collection cache** — only for `queryBySchema` with `skip === 0` (working set). Warm hits still fetch the page to detect newer `timeCreated`, then merge/dedupe.
- **Item cache** — keyed by `seedUid` + options fingerprint (`expandRelations` / `hydrateStorage` / `include` / changelog filters). Default latest-only key remains `e1-h1`. Filled by `getSeed` and write-through from collection/month queries.
- **`cache: false`** — skip all cache reads/writes for that call.
- **`skip > 0`** — no collection cache; still write-through items when cache is enabled.
- Refresh lock — concurrent `queryBySchema` for the same schema share one in-flight refresh.

Feed still owns serialized RSS/Atom/JSON bodies, HTTP `ETag` / 304, and image-metadata probing.

## Init

Call `initializeQueryPlatform()` once (registers Node EAS + Arweave clients), or rely on `getSeed` / `queryBySchema` which initialize automatically.
