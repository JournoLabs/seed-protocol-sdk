# 0016. Schema changes write a new version file; database rows change in place by id

- **Status:** Accepted
- **Date:** 2026-10-18 (records the design in place since early 2026)
- **Scope:** `@seedprotocol/sdk` (`Schema`, `loadOrCreateSchema`, `helpers/updateSchema.ts`, `helpers/schema.ts`, `helpers/db.ts`, `processSchemaFiles`)

## Context

A schema exists twice: as a JSON file, which apps ship and other tools read, and as rows in
`schemas`, `models`, `properties` and `model_schemas`, which items reference by id. Edits have to
keep both in step without breaking the items that already point at models and properties, and old
versions of a schema must stay readable.

## Decision

**Creation.** `Schema.create(name)` for a name with no file writes version 1 immediately, with
`models: {}`, and returns the cached instance on later calls. There is no deferred or draft
creation.

**Versions.** Saving changes writes a new file, `{name}-v{n}.json`, and keeps the older files.
Init loads only the latest version of each schema (`listLatestSchemaFiles`).
`saveNewVersion()` writes only when the schema has edits.

**Rows change in place.**
- A model rename updates its `models` row. Foreign keys use ids, so properties and items keep
  pointing at it.
- A property type change updates the property's row (`dataType`, and `refModelId`, which is
  cleared for types that aren't relations).
- A property rename updates the property's row and moves its metadata rows to the new name (ADR
  0008, sections 5 and 6, which also records that a schema's `migrations` list is not applied).

**Deletes keep rows.** Removing a model or property from a schema removes it from the next
version file but keeps its rows and the items' metadata, so older data stays readable. Deleting
the only model in a schema is refused. A model delete can remove or detach the properties that
reference it (`removeReferencingProperties`).

## Consequences

Old schema versions and the items written against them stay readable, and ids stay stable across
renames. Every `Schema.create` for a new name leaves a file even if no models are ever added.
Deleted models and properties accumulate as rows. A file and its rows can disagree if a write
fails halfway, since the file write and the row updates are not one transaction.

## Alternatives considered

- **Lazy file creation** (write on the first model) and **draft mode** (write on an explicit
  save): considered for empty schemas; immediate creation was kept for its simplicity.
- **Create a new property row on rename and keep the old one:** the first implementation. It
  left items' values under the old row, which is why renames now move metadata.
- **Delete and recreate a renamed model:** breaks relationships and loses data.
