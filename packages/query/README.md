# @seedprotocol/query

Canonical **Seed JSON** reads from remote EAS (Seed → Version → property attestations).

Feed generation (`@seedprotocol/feed`) uses this package to assemble items; RSS/Atom/JSON Feed formatting and HTTP caching stay in feed.

## Phase 1 scope

- **Remote-only** assembly (EAS GraphQL + Arweave gateway hydration)
- `getSeed(seedUid)` — one seed’s canonical JSON envelope
- `queryBySchema(schemaName, { limit, skip })` — paginated collection
- `queryBySchemaForMonth` — calendar-month listing (used by feed archives)
- Resolve mode: **latest Version**, then newest property attestation per `(version, schemaId)`

Later phases: shared caching, changelog, `source: 'local' | 'remote' | 'auto'`, SDK sync consolidation.

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

const { items, limit, skip } = await queryBySchema('post', { limit: 20, skip: 0 })
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

Options on both APIs: `expandRelations` (default `true`), `hydrateStorage` (default `true`).

## Init

Call `initializeQueryPlatform()` once (registers Node EAS + Arweave clients), or rely on `getSeed` / `queryBySchema` which initialize automatically.
