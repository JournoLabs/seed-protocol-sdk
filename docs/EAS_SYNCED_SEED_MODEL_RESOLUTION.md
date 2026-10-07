# Resolving the model of EAS-synced seeds (plan)

Status: not started. The seam exists; the matching logic does not.

## Background

Model names are only unique within a schema. Two schemas can each define a `Post`, and each gets
its own `models` row. Every item records its model in `seeds.model_file_id` (the model's
`schemaFileId`, i.e. `Model.id`), so code resolves an item's model and properties from that,
not from the name.

Items created locally always record it. Items pulled from EAS don't. An EAS seed attestation
identifies its model only by the EAS schema `bytes32 <model_name>`, which is the same for every
schema that defines a model with that name.

## Current behaviour

- `syncDbWithEas` calls `resolveModelForSyncedSeed(seed)`
  (`packages/sdk/src/db/read/resolveModelForSyncedSeed.ts`) for each new seed and stores the result
  in `seeds.model_file_id`. It currently always returns `undefined`.
- With no `model_file_id`, lookups fall back to the model name. That works while only one schema
  defines the name. If the name is ambiguous:
  - Background work (EAS metadata sync, `property_id` backfill) skips the seed and emits
    `MODEL_AMBIGUOUS_EVENT` (`'model:ambiguous'`) with the model name, schema names and seed ids.
  - Loading or using the item directly throws `AmbiguousModelError`.
- Local seeds from before `model_file_id` existed that can't be backfilled are handled separately:
  a one-time reset of local item data (`resetAmbiguousLegacyItemData`). It is not part of this plan.

## Plan

Implement `resolveModelForSyncedSeed` so it returns the matching model's `schemaFileId`:

1. **Candidates:** the local models whose snake_case name matches the seed's `type`. If there is
   exactly one, return it.
2. **Match by properties:** compare the property attestations synced for the seed's versions
   (EAS schema names `<easType> <property_name>`, see `metadata.property_name` / `schema_uid`) with
   each candidate model's properties (`properties` rows: name and data type). Pick the candidate
   whose property set contains all of the seed's properties. If exactly one fits, return it.
3. **Tie-breakers to consider:** `model_uids` / `property_uids` (EAS uids recorded per model or
   property row), the publisher address, and app-level hints (e.g. the app's configured schemas).
4. **Still ambiguous:** return `undefined` and keep today's behaviour (skip and emit, or throw on
   access). Consider persisting unresolved seeds so the app can list them.

Open questions:

- Seeds with no property attestations yet (a seed synced before its versions): retry when versions
  arrive? `saveEasPropertiesToDb` is the natural place to re-run resolution.
- Should a later schema import re-resolve seeds that were previously unambiguous? (A new schema
  defining the same name makes old `model_file_id`-less seeds ambiguous.)
- Once real user data is at stake, replace the one-time reset with a migration path.
