# 0006. Schemas scope seeds on the client, not on-chain

- **Status:** Proposed
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
down the `Post` seeds that have those properties, and associate them with my schema. If
I mark both as required, only seeds that have both.

## Decision

### 1. A schema's models filter which seeds it sees

For each model in a schema, a seed of that type **matches** when its latest version
has property attestations that satisfy the model's definition:

- If any of the model's properties are `required`, every required property must be
  present.
- Otherwise, at least one of the model's properties must be present.

"Present" means a canonical (latest per `refUID` + `schemaId`) attestation whose schema
is `"<easType> <snake_name>"` for that property, the same string publish registers.

`required` today means only "publishing fails if a required relation, image or file is
missing" (`properties.required`, `getPublishPayload`). This ADR widens it to "an item of
this model must have this property", which covers both meanings. Publish behaviour for
non-relation properties doesn't change.

### 2. Seeds link to schemas in a local join table

Add `seed_schemas (seed_local_id, schema_id, source, linked_at)`, unique on
`(seed_local_id, schema_id)`. It is many-to-many: one `Post` seed can match a `{title}`
schema and a `{title, content}` schema at the same time.

- **Local create:** `Item.create` links the new seed to the schema of the model that
  created it (`source = 'created'`).
- **Sync:** each synced seed is linked to every local schema whose model it matches
  (`source = 'sync'`).
- **Schema change:** when a schema's model definition changes, re-evaluate that model's
  `sync` links from local metadata. `created` links are kept.
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

- **Phase 1:** keep the forward fetch (seeds → versions → properties) and evaluate
  matches in `runSyncFromEas` after properties are fetched. Store seeds, versions and
  metadata only for seeds that match at least one local schema. Non-matching seeds are
  skipped, not stored.
- **Phase 2 (optimization):** fetch backwards to cut transfer. Query property
  attestations by `schemaId in [schema's property UIDs]` and `attester in addresses`,
  take their `refUID`s as version UIDs, then fetch those versions and their seeds,
  filtered to the model's `bytes32 <snake>` schema. Then fetch the full property set for
  matching versions only.

### 5. Reads default to the active schema

Item reads take an optional schema and, when one is known, list only seeds linked to it
through `seed_schemas`:

- `getItemsData`, `Item.all`, `useItems` and the local query source gain a `schemaName`
  option, next to the existing `addressFilter`.
- The client gets an **active schema** (config, overridable per call). When it's set,
  reads use it by default. When it isn't, reads behave as today (by `seeds.type`), so
  existing apps keep working.
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
a model of that type, it applies the match rule to the seed's local metadata. Seeds with
no local versions (drafts) link to every schema with that model type, so nothing a user
can see today disappears.

## Consequences

- An app sees only the seeds its schema describes. Two apps on one device with
  different `Post` schemas no longer mix each other's items.
- Sync stores less. Phase 1 transfers the same amount as today, and phase 2 transfers
  less.
- Matching is evaluated against the latest version. A seed whose newer version drops a
  required property stops matching on the next sync. Its `sync` link is removed and it
  drops out of that schema's lists. Local data isn't deleted.
- **Breaking for consumers that set an active schema:** lists shrink to matching seeds.
  Apps that don't set one see no change. That needs a minor version and release notes.
- `required` gains a sync meaning. A schema that marks a property `required` for publish
  validation also filters sync by it.
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
- **A new property flag instead of widening `required`.** It avoids changing what
  `required` means, but developers would set two flags for one idea ("an item of this
  model has this property").

## Open questions

- Match against the latest version only, or any version? This ADR says latest.
- Should a model be able to opt out of filtering (sync every seed of the type), for
  example a `Tag` model used only as a relation target? Related seeds fetched by
  `getRelatedSeedsAndVersions` probably bypass the filter regardless.
- Where the active schema lives: client config, `SeedProvider` prop, or both.
- Does `syncDbWithEas`'s "only newly inserted seeds get versions fetched" behaviour
  (`saveEasSeedsToDb` returns new UIDs only) need fixing first? Matching needs current
  versions for existing seeds too.
