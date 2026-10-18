# 0009. A schema sets how strictly EAS names match its models and properties

- **Status:** Accepted
- **Date:** 2026-10-15
- **Scope:** `@seedprotocol/sdk` (schema file format, EAS sync, model resolution), `@seedprotocol/eas` (`easNames.ts`)

## Context

ADR 0008 matches names from EAS to local models and properties at three tiers: exact, normalized
(case and separators) and fuzzy (also a plural `s` and a relation's `id`/`ids`). It accepts the
loosest tier everywhere. As more apps publish under the same EAS schemas, a developer will see
seeds and properties from publishers who spell names differently. Some want that, for
discovery. Others want only what matches their own names, so nothing unexpected from another
publisher lands in their data.

## Decision

### The field

A schema file can set `nameMatch: 'exact' | 'normalized' | 'fuzzy'` on a property, a model, or
at its top level:

```json
{
  "name": "Blog",
  "nameMatch": "normalized",
  "models": {
    "HTMLPage": {
      "nameMatch": "exact",
      "properties": {
        "title": { "type": "Text", "nameMatch": "fuzzy" },
        "bodyHtml": { "type": "Text" }
      }
    }
  }
}
```

The first one set wins: the property's, then its model's, then the schema's, then `fuzzy`. A
model's value is both how its own name matches and the default for its properties. A value that
isn't one of the three warns when the schema loads and is ignored.

The name is `nameMatch`, not `match`, because ADR 0006 reserves `match` and `matchMode` for which
seeds a schema sees. `nameMatch` decides which names count as the same model or property.

### Levels

An EAS name N matches a local name L when:

| level | N matches L when | `HTMLPage` accepts |
|---|---|---|
| `exact` | N is `easName(L)`, the name this SDK publishes | `html_page` |
| `normalized` | the lowercase alphanumerics of both are equal | also `htmlpage`, `HtmlPage`, `html-page` |
| `fuzzy` | ADR 0008's fuzzy key is equal | also `html_pages`; relations also `author_id` |

`exact` used to be "`easName` of both is equal" in `easNames.ts`. It now means N is exactly what
publish writes, so `Title` is a normalized match for `title`, not an exact one. At the default
level only tier ranks change.

ADR 0008's rules still hold at every level: the tightest tier wins, a tie in the best tier
matches nothing, and only names from EAS are matched this way. Names in local code keep exact
lookups. A property attestation whose name one of the model's properties would match, but only
at a looser level than that property allows, is dropped. It isn't stored under a name of its own.

### Where it applies

- **Fetching model schemas:** `getModelSchemasFromEas` asks EAS for the names each model can
  match at its level (`easNamesToFetch`). At `exact` that is only `bytes32 <easName>`.
- **Matching model schemas and types:** `getModelSchemas().matchModelRecord`,
  `Model.findByModelType`, `resolveModelRecordByNameOrType` and `canonicalizeModelTypes`.
- **Mapping property attestations** in `syncDbWithEas` (`resolveSyncedPropertyName`).

When several schemas define a model with the same name, its name matches at the tightest of
their levels, because they share one EAS schema and one `seeds.type`.

### Storage

The levels are read from the schema file stored with each model's schema row
(`schemas.schema_data`), as property validation rules already are. There is no migration.
`db/read/nameMatchLevels.ts` caches them. Schema and model writes clear the cache, each sync run
reloads it, and synchronous readers (`Model.findByModelType`) use the last load.

Import, the Schema machine and `Schema.saveNewVersion` keep `nameMatch` at every level. It
counts in the schema content comparison only when set, so existing schema ids don't change.

## Consequences

- Strict developers can stop other publishers' spellings at the model or property they care
  about, and keep loose matching elsewhere.
- Under `exact`, seeds and properties published under older SDKs' names (`htmlpage`,
  `author_id`) are not found. That is documented, not special-cased. Developers who want them
  use `normalized` or `fuzzy`.
- Tightening a level affects later syncs only. Rows already stored stay. Removing them is left to
  ADR 0006's re-evaluation, once `seed_schemas` exists.
- `nameMatch` lives in the schema file only. A model or property created in code
  (`Model.create(..., { properties })`) takes its schema's level, or `fuzzy`.
- Before the first load in a session (sync, or the post-init model type pass),
  `Model.findByModelType` matches at `fuzzy`.

## Alternatives considered

- **Columns on `models`, `properties` and `schemas`.** That was the first design. It needs a
  migration and the edit-check plumbing every property column has, for a setting that only the
  schema file sets. Reading the stored file is the existing pattern for file-only settings.
- **`aliases: string[]`** per model or property, accepted at every level. Left out for now. If
  added, they count as exact keys.
- **A per-call `nameMatch` on `syncFromEas`**, like ADR 0006's per-call `matchMode`. Left out until
  someone asks.
- **Edit-distance matching as a fourth level.** ADR 0008 rejects it as a default. It can be added
  as an opt-in level later without changing this field.
