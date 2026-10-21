# 0016. Schema changes write a new version file; database rows change in place by id

- **Status:** Accepted; amended 2026-10-21 (see the end)
- **Date:** 2026-10-18 (records the design in place since early 2026)
- **Scope:** `@seedprotocol/sdk` (`Schema`, `checkExistingSchema`, `helpers/schemaApply.ts`, `helpers/updateSchema.ts`, `helpers/schema.ts`, `helpers/db.ts`, `processSchemaFiles`)

## Context

A schema exists twice: as a JSON file, which apps ship and other tools read, and as rows in
`schemas`, `models`, `properties` and `model_schemas`, which items reference by id. Edits have to
keep both in step without breaking the items that already point at models and properties, and old
versions of a schema must stay readable.

## Decision

**Identity.** A schema is its file id (`schemas.schema_file_id`, the file's `id`). Its name is
data: version files, rows and lookups match by id, and the name only finds a schema that has no id
yet (an import without one, `Schema.create(name)`).

**Creation.** `Schema.create(name)` for a name with no row or file writes a draft row, version 1,
with `models: {}`, and no file. The first `saveNewVersion()` writes the version 1 file.

**Versions.** Saving changes writes the next version file, `<id>_<name>_v<n>.json`, and keeps the
older files. Each version file is the previous one with the change applied
(`writeNextSchemaVersion`), so fields the change doesn't touch stay. Renaming a published schema is
a version too: the next file carries the new name. Init applies the newest file of each id that its
row hasn't applied (`processSchemaFiles`). `saveNewVersion()` writes only when the schema has edits.

**One apply.** Every schema file reaches the rows through `applySchemaFile`: it reads any accepted
property shape (`normalizePropertyRecordSchema`), assigns missing ids, stores the version file, and
writes the schema, model, property and link rows in one transaction. The row records the file's
content hash; a file whose id, version and hash the row already has is not applied again. Missing
ids are assigned once, at first apply, and written into the stored file: an id the stored schema
already has for that name is kept, and a new one is derived from the schema, model and property
names.

**Rows change in place.**
- A model rename updates its `models` row. Foreign keys use ids, so properties and items keep
  pointing at it.
- A property type change updates the property's row (`dataType`, and `refModelId`, which is
  cleared for types that aren't relations).
- A property rename updates the property's row and moves its metadata rows to the new name (ADR
  0008, sections 5 and 6, which also records that a schema's `migrations` list is not applied).

**Deletes keep rows.** Removing a model or property from a schema removes it from the next
version file but keeps its rows and the items' metadata, so older data stays readable. A model the
new version drops is unlinked from the schema (`model_schemas`).

## Consequences

Old schema versions and the items written against them stay readable, and ids stay stable across
renames and edits. A `Schema.create` for a new name leaves a draft row until it is saved.
Deleted models and properties accumulate as rows. The rows of one apply are one transaction, but the version
file is written before it: a failed transaction leaves a file the rows don't reflect yet, which the
next init applies.

## Alternatives considered

- **Lazy file creation** (write on the first model) and **draft mode** (write on an explicit
  save): considered for empty schemas; immediate creation was kept for its simplicity.
- **Create a new property row on rename and keep the old one:** the first implementation. It
  left items' values under the old row, which is why renames now move metadata.
- **Delete and recreate a renamed model:** breaks relationships and loses data.

## Amendment (2026-10-21): identity by file id, one apply

Audit decision D5 (`docs/private/sdk-audit/DECISIONS.md`). The decision above now reads as the code
behaves; what changed:

- File names are `<id>_<name>_v<n>.json`, as the code always wrote them, not `{name}-v{n}.json`.
  The `<name>-v<n>.json` pattern was only read for minimal import files, re-imported on every init;
  that import is removed.
- Identity is the file id. Files used to be grouped by `metadata.name`, so a schema rename (which
  changed only the row) was undone at the next init, when the old-name files looked like a schema
  without a row (audit defect 1.4). A rename now writes the next version file.
- Ids an import has to assign are derived from the names, not from a hash of the whole schema, so
  adding a property no longer changes every id in the file.
- The refusal to delete a schema's only model is dropped: nothing implemented it and nothing relied
  on it. Creation writes a draft row, not a file, as the code did since draft mode was added.
