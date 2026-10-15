# 0008. One EAS name per property and model, matched loosely when reading

- **Status:** Proposed
- **Date:** 2026-10-15
- **Scope:** `@seedprotocol/sdk` (publish payload, EAS sync, model resolution, schema import),
  `@seedprotocol/eas`, `@seedprotocol/publish` (schema registration), `@seedprotocol/query`

## Context

A model or property name in a schema file (`HTMLPage`, `coverURL`, `author`) becomes an EAS schema
name when it is published (`bytes32 html_page`, `string cover_url`). On another device, EAS sync
turns the EAS name back into a local model or property. The two directions disagree today, so
seeds published by one device can come back wrong, or not at all, on another.

**Five snake_case functions.** They give different names for the same input:

| input | publish (`helpers`, `eas/utils`, publish's `ensureEasSchemas`) | drizzle `toSnakeCase` (model lookup in sync, metadata writes) | query's local source |
|---|---|---|---|
| `HTMLPage` | `htmlpage` | `html_page` | `html_page` |
| `ID3Tag` | `id3tag` | `id_3_tag` | `id3_tag` |
| `imageV2` | `image_v2` | `image_v_2` | `image_v2` |
| `New model` | `new model` | `new_model` | `new model` |
| `coverURL` | `cover_url` | `cover_url` | `cover_url` |

The EAS model name is built with the publish column (`sdk/src/eas.ts`), and sync resolves it with
drizzle's (`resolveModelRecord.ts`). So an `HTMLPage` seed synced as `htmlpage` resolves to no
model. Property schema UIDs looked up when a draft row is written (`createMetadata`) use drizzle's
name, while publish registers the simple one.

**Names that don't survive a round trip.** Sync maps a property name back with
`camelCase(snake)` (`syncDbWithEas.ts`). `published_at` comes back as `publishedAt`, and `coverURL`
as `coverUrl`, which don't match the local properties named `published_at` and `coverURL`. Nothing
checks names when a schema loads.

**Single Relation and Image names.** Locally, a single Relation, Image, File or Html property is
stored as `<name>Id` (`helpers/metadataPropertyNames.ts`). Publish names the EAS schema from the
ItemProperty's storage name, which is `author` or `authorId` depending on how the property was
constructed, so the same property can be published as `bytes32 author` or `bytes32 author_id`.
List relations are always `<name><Model>Ids` (`author_identity_ids`).

**Relation detection in sync.** Sync treats a property as a relation only when its EAS name ends
in `_id` or `_ids` (`isRelationPropertyName`). A relation published as `bytes32 author` syncs as a
plain value: it isn't followed to its related seed and doesn't resolve as a relation.

**The rename guess on schema import.** When a property name in the schema file matches no stored
property, `helpers/db.ts` treats the first unmatched stored property of the same type as renamed
to it. With one property added and an unrelated one removed in the same edit, that is a wrong
rename. Even a right one leaves the values in `metadata` under the old name: only
`renameModelProperty` moves them.

**Names already on chain.** Every seed published so far used the publish column above. They stay
on chain under those names.

**Where this is going.** As more apps use the SDK, schemas that mean the same thing will differ in
small ways (`htmlPage` vs `HTMLPage` vs `html_page`, `post` vs `posts`). Matching names that are
meant to be the same is a feature to build on, not a bug to patch once. How strictly a developer
wants that matching is a separate, configurable choice: the `nameMatch` design
(side-session note `name-match-strictness-design.md`, to become ADR 0009).

## Decision

### 1. One function writes EAS names

`easName(name)` in `@seedprotocol/eas` is the only function that turns a local name into an EAS
name. The SDK, publish and query import it; the other four are removed.

It splits words at a lowercase-or-digit to uppercase boundary and before the last capital of an
acronym followed by lowercase, turns every run of other characters (spaces, hyphens, dots) into
`_`, trims `_` from both ends, and lowercases:

`HTMLPage → html_page`, `ID3Tag → id3_tag`, `imageV2 → image_v2`, `New model → new_model`,
`coverURL → cover_url`, `published_at → published_at`.

Everything that writes a name to EAS uses it: model schemas, property schemas, schema-name
attestations, and the property schema UID lookups made when draft rows are written. Publish and
the draft lookup then agree on every name.

### 2. Reading matches names, it doesn't reverse them

No code turns an EAS name back into a local name by changing its case. Instead, an EAS name is
matched against the local candidates, models for a seed type and the model's properties for a
property attestation, by comparing keys:

- **exact key:** `easName(local) === easName(eas)`.
- **normalized key:** both lowercased, with every non-alphanumeric character removed.
  `html_page`, `htmlpage`, `HTMLPage` and `html-page` share `htmlpage`. This is how seeds
  published under the old names are found.
- **fuzzy key:** the normalized key with a trailing plural `s` removed and, for relation
  properties only, a trailing `id` or `ids` removed. `posts` matches `post`; `author_id`
  matches the relation `author`. No edit distance: `title` must never match `tile`.

How loose a match is accepted depends on the `nameMatch` level (exact, normalized or fuzzy), set per
property, per model or per schema. The rules that hold at every level:

- The tightest match wins: an exact key beats a normalized one, which beats a fuzzy one.
- A tie within the best tier maps to nothing. A property is skipped with a warning; a model goes
  through the existing `AmbiguousModelError` skip path.
- Property types must agree: `uint256 title` never maps to a Text `title`.
- When one version has attestations for two names that map to the same property (`title` and
  `Title`), the tighter match wins, then the newer one.

The synced row is stored under the local property's name. `published_at` and `coverURL` come back
as themselves.

`getModelSchemasFromEas` fetches the model schemas that can match at the configured level, not just
`bytes32 <easName>`: at the normalized level and looser, that includes the old publish-column name
of each model (`bytes32 htmlpage`) and its separator and case variants.

Developer-typed names in local code (`Model.create('HTMLPage')`, `item.title`) keep exact lookups.
Matching applies only to names that come from EAS.

### 3. Single Relation and Image properties keep their schema key on chain

A single Relation, Image, File or Html property is published as `easName(<schema key>)`, with no
`_id` suffix: `bytes32 author`, `bytes32 cover_image`. This is what most of these properties have
been published as so far. The local `<name>Id` storage name stays a local detail and never reaches
EAS. List relations keep their `<name><Model>Ids` names, which they have always had.

### 4. Sync knows relations from the local model

Sync treats an attestation as a relation when the local property it matches is a Relation, Image,
File or Html property (or a List of relations), not from an `_id` suffix. The suffix check stays
only for attestations that match no local property, so related seeds are still followed for
discovery. `storage_transaction_id` and `storage_provider_transaction_id` stay excluded.

Old `bytes32 author_id` attestations still map to the relation `author`, through the fuzzy key's
`id` rule. Under `nameMatch: 'exact'` they are not found: that is what exact means.

### 5. Renames need the property's id

Importing a schema treats a stored property as renamed only when the incoming property has the
same id (the schema file's property `id`, `properties.schemaFileId`). The characteristics-based
guess is removed. A rename moves the property's `metadata` rows to the new name, as
`renameModelProperty` already does. With no id match, the import is an add plus a remove, and the
removed property's values stay in `metadata` under its old name.

### 6. `migrations` in `config.schema` are documented as not applied

They are stored and returned, and nothing runs them. The schema docs and the `migrations` type say
so. Running them is a separate decision.

### 7. Names are checked when a schema loads

Schema import warns when two models, or two properties of one model, have the same `easName`,
since they would publish to the same EAS schema. It warns, not throws: existing schema files keep
loading.

## Consequences

- Publish and sync agree on every name, and synced values land under the property names the
  developer wrote.
- **New EAS schemas for some names.** A model or property whose name differs between the old
  publish column and `easName` gets a new schema the next time it is published: acronyms
  (`HTMLPage`, `ID3Tag`), names with spaces or hyphens (`New model`), and single relations that
  were published as `author_id`. Its seeds are then spread over two schema UIDs. Readers find
  both through the normalized key. Names without acronyms, digits after capitals or separators,
  which is most of them, are unchanged.
- At the `exact` level, seeds published under the old names are not found. Developers who want
  them use `normalized` or `fuzzy`.
- The SDK takes on a matching policy that will grow. Matching stays in one module
  (`@seedprotocol/eas` `easNames.ts`, with `easName`, the three keys, and the tightest-match rule),
  so it can be tested as a table and extended in one place.
- Schema import no longer guesses renames. A developer who renames a property in a schema file
  without keeping its `id` gets an add and a remove, with the old values left under the old name.
- Rows synced under the wrong name before this change (`publishedAt` for `published_at`) stay
  until their seed is synced again. The sync then writes the right name. The old rows aren't
  migrated.

## How this fits `nameMatch`

The `nameMatch` design (approved 2026-10-15, to become ADR 0009) sets the default level to what
this ADR ships, which is `fuzzy`. So an existing schema file sees old-name seeds and `author_id`
relations with no change. Its other answers this ADR relies on:

- **`exact` and old names.** `exact` doesn't find seeds published under the old names; developers
  who want them use `normalized` or `fuzzy`. Documented, not special-cased.
- **Tightening later** affects future syncs only; rows already stored stay.
- **No `aliases`** for now. If they are added later, they count as exact keys at every level.

This ADR defines what `fuzzy` means (section 2: plural `s` and relation `id`/`ids`, no edit
distance). ADR 0009 adds the setting and where it's stored. Until it ships, every name behaves as
`fuzzy`.

## Alternatives considered

- **Keep the simple snake_case function as the one writer.** It avoids new EAS schemas, but keeps
  `htmlpage` and `id3tag`, which are hard to read and collide (`HTMLPage` and `HtmlPage` and
  `HTMLpage` all give `htmlpage`). Keith chose the better function and matching instead, since
  matching is needed anyway as names diverge across apps.
- **Publish to an existing schema when one with a matching key is already on chain.** It keeps a
  model's seeds under one UID, but makes what publish writes depend on what other apps have
  registered, which differs per chain and can change. Publish stays deterministic; readers match.
- **Edit-distance matching.** It finds typos, but also maps `title` to `tile` and `post` to
  `posts_count`. Too many false positives for a default; ADR 0009 can offer it as an opt-in.
- **Make `author_id` the on-chain name for single relations.** It would let sync keep its suffix
  rule, but every published relation would need a new schema, and the suffix rule would still miss
  relations from other SDKs. Keith chose keeping `author` on chain and detecting relations from the
  local model.
- **Keep the rename guess, but only when there is exactly one candidate.** Still wrong when one
  unrelated property is removed and one added. The id is the only reliable signal.
