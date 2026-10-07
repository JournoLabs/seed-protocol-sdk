# 0006. Schemas scope seeds on the client, not on-chain

- **Status:** Accepted
- **Date:** 2026-10-07
- **Scope:** `@seedprotocol/sdk` (local DB, EAS sync, item reads), `@seedprotocol/react` item hooks

## Context

A model type is global on-chain. Every schema's `Post` publishes seeds under the same EAS
schema, `bytes32 post`. Local seeds record that as `seeds.type = 'post'` and
`seeds.schema_uid`. Property attestations are global too: a property's EAS schema is
`"<easType> <snake_name>"`, so `string title` is the same UID for every model with a
`title`. Nothing on-chain says which app schema a seed belongs to, and that's intended.
Different apps should be able to read and write the same `Post` seeds.

The local DB used to blur schemas in a different way:

- **Model rows.** Lookups by model name picked whichever `models` row came first and
  sometimes rewrote it. Importing schema B's `Post` took over schema A's row, its file id,
  and its properties. Branch `claude/sweet-mcnulty-c97c9a` fixes this with
  `getModelRecord(s)ByName`: a name resolves only to rows linked to the schema through
  `model_schemas`, or to unlinked stubs with no file id. This ADR assumes that change has
  landed, so each schema has its own `models` row.
- **Seeds.** No local table links a seed to a schema. Item reads filter by
  `seeds.type` only (`getItemsData`, `getItemData`, `useItems`). When a schema is needed,
  it's guessed from the model name (`getItemData`, `resolveSchemaNameForSeedType`).
- **Sync.** `runSyncFromEas` fetches every seed of every local model's EAS schema from
  the sync addresses, then every version and property attestation under them. A schema
  can't say which seeds it actually wants.

What developers expect: if my `Post` defines `title` and `content`, the SDK should bring
down the `Post` seeds that have either of those properties, and associate them with my
schema. If I mark both as needed for matching, only seeds that have both. By default any
version's attestations count. A developer can ask for strict matching against the latest
version instead.

## Decision

### 1. A schema's models filter which seeds it sees

Each property in a schema file gets a `match` field that says how it decides whether a
seed of that model belongs to the schema:

| `match` | Meaning |
|---|---|
| `'any'` (default for model properties) | Counts toward "the seed has at least one of the model's properties" |
| `'required'` | The seed must have this property |
| `'requiredTogether'` | The seed must have this property on the same version as every other `'requiredTogether'` property |
| `'ignore'` (default for internal properties) | Never qualifies a seed |

Internal properties default to `'ignore'`, because they say nothing about whether a seed
fits the model. These are the ones the SDK adds or derives rather than the developer
defining them: `storageTransactionId` and list-relation `*_ids` storage names. A
developer can still set `match` on them explicitly.

```json
"Post": {
  "properties": {
    "title":   { "type": "Text", "match": "requiredTogether" },
    "content": { "type": "Text", "match": "requiredTogether" },
    "summary": { "type": "Text" }
  }
}
```

A seed **matches** a model when, among the candidate attestations (see the modes
below):

- every `'required'` property has an attestation;
- every `'requiredTogether'` property has an attestation, all on one version;
- and, if the model has no `'required'` or `'requiredTogether'` properties, at least
  one `'any'` property has an attestation.

A property attestation counts when its schema is `"<easType> <snake_name>"` for that
property (the string publish registers) and its `refUID` is a candidate version of the
seed.

#### Canonical attestation per property

A version can carry several attestations of the same property, for example after a
same-version patch publish. Matching and stored values use one **canonical**
attestation per `(version, property schema)`: the newest non-revoked one, by greatest
`timeCreated`. Older or revoked attestations of that property on that version are
ignored. A property is **present** on a version when it has a canonical attestation.

`pickLatestPropertyAttestationsByRefAndSchema` (`packages/eas/src/easPropertyCanonical.ts`)
is documented this way but doesn't check `revoked`, and `runSyncFromEas` passes revoked
attestations into it (`excludeRevoked: false`). So today a revoked newest attestation
wins. It has to skip revoked attestations before matching relies on it.

So in loose mode a property is present if *any* candidate version has a canonical
attestation of it. In strict mode, only the latest version's canonical attestation
counts.

`match` is separate from `required`. `required` keeps its current meaning: publish
fails if a required relation, image or file is missing.

#### Loose and strict mode

The mode decides which versions' attestations are candidates:

- **Loose (default):** any version of the seed. An attestation of `title` on an old
  version still counts after a newer version leaves it out. `'required'` properties may
  come from different versions. `'requiredTogether'` properties must share one.
- **Strict:** only the seed's latest version (highest `timeCreated` among its
  non-revoked version attestations). `'required'` and `'requiredTogether'` behave the
  same here, because there's only one version. A time window for choosing "latest" is
  deferred to a later ADR. Until then, strict always uses the current latest version.

The mode is set in two places, and the per-call setting wins:

- **Per model in the schema:** `"Post": { "matchMode": "strict", ... }`. The default is
  `'loose'`.
- **Per call:** a `matchMode` option on sync (`syncFromEas`) and on item reads
  (`Item.all`, `useItems`, the local query source).

#### Sync scope per model

A model can loosen or replace the property match with `syncScope`:

```json
"Tag": { "syncScope": "referenced", "properties": { "name": { "type": "Text" } } }
```

| `syncScope` | Seeds of this model that sync down |
|---|---|
| `'match'` (default) | Seeds from the sync addresses that match by `match` and `matchMode` |
| `'all'` | Every seed of the type from the sync addresses, without a property check |
| `'referenced'` | No fetch of its own. Only seeds of this type that a synced seed of another model relates to |

The sync addresses (owned, watched, and `setAdditionalSyncAddresses`) still bound
`'match'` and `'all'`. No scope pulls every seed of a type from every attester.

**Referenced seeds**, whatever the scope: when a synced seed has a relation to another
seed, sync fetches the target by ID from any attester, as `getRelatedSeedsAndVersions`
does today. It stores the target and links it to the schema with `source = 'related'`,
so the relation resolves and the target shows in that model's lists in both modes. This
goes one level deep, as today. A related seed's own relations aren't followed unless
that seed was also synced in its own right.

- With `'match'` or `'all'`, a model gets its own seeds plus any referenced ones.
- With `'referenced'`, it gets only referenced ones. This suits a `Tag` model that is
  only used as a relation target: you get exactly the tags your posts use.

### 2. Seeds link to schemas in a local join table

Add `seed_schemas (seed_local_id, schema_id, source, matches_loose, matches_strict,
evaluated_at)`, unique on `(seed_local_id, schema_id)`. It is many-to-many: one `Post`
seed can match a `{title}` schema and a `{title, content}` schema at the same time.

Both modes are stored, so a per-call `matchMode` can pick the column without
re-evaluating. A strict match always implies a loose one: the strict candidates are a
subset of the loose ones, and every rule only checks that attestations exist.

- **Local create:** `Item.create` links the new seed to the schema of the model that
  created it, with `source = 'created'` and both columns true.
- **Sync:** each synced seed is linked to every local schema whose model it matches
  loosely, or whose model has `syncScope: 'all'` (`source = 'sync'`). Seeds that match no
  schema in the requested mode aren't stored.
- **Related:** a relation target fetched for a synced seed is linked to that seed's
  schema with `source = 'related'`, and both match columns true.
- **New versions:** `matches_loose` only ever turns true, because adding attestations
  can't undo a loose match. `matches_strict` is re-evaluated when a seed gets a new
  latest version.
- **Schema change:** when a schema's model definition (`match` or `matchMode`) changes,
  re-evaluate that model's `sync` links from local metadata. `created` links are kept.
- **Schema destroy:** delete its links. A seed with no remaining links stays in the DB
  and is no longer listed (see 5).

### 3. Each schema keeps its own model rows

Two schemas that both define `Post` get two `models` rows, even when the definitions are
identical. Each row has its own properties, `isEdited` flags and `model_schemas` link.
The "same name and same properties means same thing" idea holds where it matters: on
chain, where both schemas see the same seeds.

### 4. Sync filters on the client

EAS's GraphQL API can't express "seeds that have a version with a property attestation
in [A, B]". `AttestationWhereInput` has no relation to the attestation a `refUID` points
at or to the attestations that point back, only a plain `refUID` string filter. So:

- **Phase 1:** keep the forward fetch (seeds → all their versions → property
  attestations) and evaluate both modes in `runSyncFromEas` after properties are fetched.
  This is correct for both modes, because strict needs every version to find the latest.
  Store seeds, versions and metadata only for seeds that match at least one local schema
  in the effective mode. Skip the rest.
- **Phase 2 (optimization, loose mode):** fetch backwards to cut transfer. Query
  property attestations by `schemaId in [the model's matching property UIDs]` and
  `attester in addresses`. Their `refUID`s are candidate version UIDs. Fetch those
  versions, take their `refUID`s as seed UIDs, and keep seeds whose schema is the model's
  `bytes32 <snake>`. Evaluate the rules on that set, then fetch full versions and
  properties only for matching seeds. Strict mode keeps the phase 1 path, because the
  latest version may carry none of the matching properties.

`runSyncFromEas` today fetches versions only for seeds it newly inserted
(`saveEasSeedsToDb` returns new UIDs only). Strict mode needs new versions of existing
seeds too, so that has to be fixed first.

### 5. Reads default to the active schema

Item reads take an optional schema and, when one is known, list only seeds linked to it
through `seed_schemas`:

- `getItemsData`, `Item.all`, `useItems` and the local query source gain `schemaName`
  and `matchMode` options, next to the existing `addressFilter`. The mode picks
  `matches_loose` or `matches_strict`. Without one, the model's `matchMode` from the
  schema applies.
- The client has an **active schema**. Reads and sync use it when a call doesn't name
  one. When there isn't one, reads behave as today (by `seeds.type`), so existing apps
  keep working.

#### Choosing the active schema

The common setup is one `seedSchema.json` at the project root, and that file is the
active schema unless something more specific says otherwise. The first of these that is
set wins:

1. **Per call:** `schemaName` on `Item.all`, `useItems`, `syncFromEas`, and so on.
2. **`SeedProvider` prop:** `<SeedProvider activeSchema="Blog">`, for React subtrees.
3. **Client config:** `config.activeSchema` (a schema name).
4. **The app's canonical schema:** `config.schema`, the existing "single canonical
   schema for the app" option (a path or an inline `SchemaFileFormat`).
5. **`seedSchema.json` at the project root,** when `config.schema` isn't set:
   - **Node:** read from `process.cwd()` at init, the same way a relative
     `config.schema` path resolves today.
   - **Browser:** the browser can't read the project root, so `@seedprotocol/vite`
     reads `seedSchema.json` at build time and passes it as `config.schema`. This is
     the plugin's first schema handling.

If none of these applies, there is no active schema. The SDK doesn't guess one from the
schemas in the DB.

Steps 4 and 5 also load and apply the schema at init, as `config.schema` does today.
Steps 1 to 3 only choose among schemas that are already loaded. Naming an unknown
schema is an error, not a silent fallback.
- An item loaded under a schema resolves its properties from that schema's model row.
  `getItemData` and `resolveSchemaNameForSeedType` stop guessing the schema from the
  model name when a link exists.

### 6. Name-keyed identifiers follow the name, not the row

- **`model_uids`:** the on-chain UID belongs to the model name, so every `models` row
  with that name gets a `model_uids` row. Today only the one row a name lookup happens to
  find gets it.
- **`metadata.property_id`:** a seed linked to two schemas has two property rows per
  name. Readers resolve properties by `(schema → model → property name)`. They don't
  trust `metadata.property_id` across schemas. It stays as a hint for the schema that
  wrote it.

### 7. Existing data

A migration creates `seed_schemas` and backfills it. For each seed and each schema with
a model of that type, it evaluates both modes against the seed's local metadata. Every
existing property gets the default `match: 'any'`, so a seed with any of the model's
properties keeps showing up. Seeds with
no local versions (drafts) link to every schema with that model type, so nothing a user
can see today disappears.

## Consequences

- An app sees only the seeds its schema describes. Two apps on one device with
  different `Post` schemas no longer mix each other's items.
- Sync stores less. Phase 1 transfers the same amount as today, and phase 2 transfers
  less.
- In loose mode (the default), a seed that matches never stops matching as new versions
  arrive, so links are stable. In strict mode, a seed whose new latest version drops a
  matching property stops matching on the next sync. It drops out of strict lists, and
  its local data isn't deleted.
- **Breaking for apps with an active schema, which includes every app that uses
  `config.schema` or has a root `seedSchema.json`:** lists shrink to seeds linked to
  that schema. Apps with none of the five sources see no change. This needs a minor
  version (pre-1.0) and release notes.
- Schema files gain three optional fields: `match` on properties, and `matchMode` and
  `syncScope` on models. Existing files stay valid. Schema file types, JSON import and
  export, and the `models` and `properties` tables need the new columns.
- **Sync narrows for existing schemas.** Today's sync behaves like `syncScope: 'all'`.
  With the `'match'` default, seeds that have none of a model's non-ignored properties
  stop syncing, even in apps that never set an active schema. In practice that means
  seeds that only have internal properties, or none at all. Seeds already in the local
  DB stay. A schema can set `'all'` to keep today's behaviour. That needs release notes.
- Many name-only lookups in the item layer (`loadOrCreateProperty`, `getPublishPayload`,
  `getPropertyIdForModelAndName`, `ModelProperty.instanceCache` keyed
  `modelName:propertyName`) need the schema threaded through. That work is mechanical
  but wide. The goofy-bose change already does it for `Item.create` and
  `loadOrCreateItem` where the schema is known.

## Alternatives considered

- **One shared `models` row for identical definitions.** The row has to split, with its
  properties, refs, `isEdited` flags and links, as soon as one schema changes its model.
  Separate rows cost a few rows and avoid that.
- **A `schema` column on `seeds`.** One seed can match several schemas, so a column can't
  hold the relation.
- **A schema dimension on-chain** (per-app EAS schemas such as `bytes32 blog_post`).
  This breaks sharing seeds across apps, which is the point of global types.
- **Filter only at read time** (store everything, hide non-matching seeds). Simpler, but
  the request is to bring down only matching seeds, and the DB keeps growing with seeds
  no schema wants. Read-time filtering is still what lists use; this ADR adds
  sync-time filtering on top.
- **Reusing `required` for matching.** It already means "publish fails if a required
  relation is missing". Overloading it would make one flag do two jobs, and there'd be
  no way to say "these must appear together".
- **A boolean flag (`matchRequired`).** It can't express "counts toward any", "must share
  a version" or "ignore" without more flags.
- **Strict as the only mode.** Simpler, but a seed would disappear from lists whenever
  an edit leaves a property out of the newest version, and the loose reverse-fetch sync
  wouldn't be possible.

## Deferred

- **Strict time window:** a way to choose "latest" within a time range. Strict mode
  uses the current latest version until a later ADR adds it.
