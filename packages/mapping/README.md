# @seedprotocol/mapping

Source → Seed model property mapping helpers and a props-driven React UI.

Use this package to:

1. Parse markdown or RSS/Atom into `SourceNode[]`
2. Optionally expand URL sources with `buildResolvedSourceNodes` (extract / file candidates)
3. Author `FieldMapping` edges (manually, via `autoMap`, or via `FieldMapper`)
4. `applyMapping` (sync copy + stored lookup) or `applyMappingAsync` (host extract/file callback) → property bag

Mappings are an edge list: one source may fan out to multiple properties (e.g. RSS
`link` → `importUrl` and `canonicalUrl`). Each property is exclusive — at most one
source may map to it. `resolve: 'extract' | 'file'` is applied by the host callback.
`resolve: 'lookup'` is a stored string → ref table on the edge — the package never
fetches, runs Readability, or loads Seed Identity items.
`resolve: 'derive' | 'assemble'` are host-applied transforms persisted on the edge
(`derive.from` is a property name; `assemble.blocks` is a host-owned string list).
A derive-only edge may omit `sourceId`. Sync and async `applyMapping` skip these jobs.

## Install

```bash
bun add @seedprotocol/mapping
```

The default entry (`@seedprotocol/mapping`) is headless — no React peer required.
For `FieldMapper`, also install React peers and import from `@seedprotocol/mapping/react`.

RSS parsing uses `rss-parser` with the same custom fields as `@seedprotocol/feed`
`parseRssString` (aligned, no hard dependency on the feed package barrel).

## Headless API

```ts
import {
  markdownToSources,
  rssXmlToSources,
  autoMap,
  applyMapping,
  applyMappingAsync,
  buildResolvedSourceNodes,
  classifyUrl,
  type TargetProperty,
  type MappingDocument,
} from '@seedprotocol/mapping'

const sources = markdownToSources(markdown)
const targets: TargetProperty[] = [
  { name: 'title', dataType: 'String' },
  { name: 'body', dataType: 'Text' },
]
const mappings = autoMap(sources, targets)
const properties = applyMapping(sources, mappings, targets)

const doc: MappingDocument = {
  version: 1,
  sourceKind: 'markdown',
  mappings,
}
```

RSS with resolve jobs:

```ts
const { items } = await rssXmlToSources(xml)
const itemSources = items[0]!
const expanded = buildResolvedSourceNodes(itemSources)
const postTargets: TargetProperty[] = [
  { name: 'importUrl', dataType: 'String' },
  { name: 'canonicalUrl', dataType: 'String' },
  { name: 'html', dataType: 'Html' },
  { name: 'featureImage', dataType: 'Image' },
  { name: 'title', dataType: 'String' },
]
const mappings = autoMap(itemSources, postTargets)
// link → importUrl/canonicalUrl (copy); missing body → link extract→html;
// image URLs → featureImage with resolve:'file'

// Sync preview applies lookup entries; extract/file stay pending:
const preview = applyMapping(itemSources, mappings, postTargets)

// Publish path — host owns HTTP / extract / store:
const { properties, errors } = await applyMappingAsync(
  itemSources,
  mappings,
  postTargets,
  {
    resolve: async ({ job, url, contentType, rawValue }) => {
      if (job === 'extract') return await hostExtractHtml(url!)
      if (job === 'lookup') return await hostLookupIdentity(rawValue!)
      return await hostFetchAndStoreFile(url!, contentType)
    },
  },
)
```

### Relation lookup (`resolve: 'lookup'`)

Map a string source (e.g. RSS `author`) onto a Relation or List-of-Relation
target (e.g. `authors` → Identity) via **stored entries on the edge**. Use Seed
model vocabulary — not a `multiple` flag:

```ts
const postTargets: TargetProperty[] = [
  {
    name: 'authors',
    dataType: 'List',
    refValueType: 'Relation',
    ref: 'Identity',
  },
]

const mappings = [
  {
    sourceId: 'rss-author',
    propertyName: 'authors',
    resolve: 'lookup' as const,
    lookup: {
      entries: [{ value: 'Jane Doe', ref: 'identity-seed-uid' }],
    },
  },
]

const doc: MappingDocument = {
  version: 1,
  sourceKind: 'rss',
  mappings,
}

// Sync apply emits refs from stored entries (extract/file still skipped):
const bag = applyMapping(itemSources, mappings, postTargets)
// bag.authors === ['identity-seed-uid']

const { properties, errors } = await applyMappingAsync(
  itemSources,
  mappings,
  postTargets,
)
// Unmatched values are omitted from the bag and listed in errors[].
// Do not fetch identities inside apply — persist the assignment, then apply.
```

`autoMap` pairs alias matches such as `author` → `authors` with
`resolve: 'lookup'` and **empty** entries. It never invents refs.

`MappingDocument.lookups` / `applyMappingAsync({ lookups })` remain a read-only
fallback for 0.6.0 documents. Prefer `FieldMapping.lookup.entries`.

`classifyUrl({ url, contentType? })` is a pure MIME/extension classifier
(`html` | `image` | `audio` | `video` | `unknown`). Enclosure nodes expose
`meta.url`, `meta.contentType`, and `meta.class` (not a stringified object).

## FieldMapper UI

Props-driven only — no Seed hooks or routing. Import from `@seedprotocol/mapping/react`.

Two layouts share the same persisted `FieldMapping[]`. **`layout` defaults to `"rows"`.**

| `layout` | Behavior |
|----------|----------|
| `"rows"` (default) | Row-based authoring. Pass **origin** sources only — transforms are chosen per row (no `@extract`/`@file` cards). |
| `"wires"` (**deprecated**) | Two-pane click-to-connect with SVG connectors. Pass `buildResolvedSourceNodes(sources)` so extract/file candidates appear as source cards. Still supported for one minor. |

When `layout="rows"`, `rowKey` picks orientation:

| `rowKey` | Behavior |
|----------|----------|
| `"property"` (default) | One row per target property; source + transform inside the row. Structurally property-exclusive. |
| `"source"` | One row per edge (insertion order); conflict banner when two rows claim one property; coverage banner for missing `required` targets. |

Mark targets with `required: true` so coverage / default filters surface missing fields. Default visible set for property mode is mapped + required (`defaultRows="requiredAndMapped"`).

```tsx
import { useState } from 'react'
import {
  buildResolvedSourceNodes,
  markdownToSources,
  rssItemToSources,
  applyMappingAsync,
  type FieldMapping,
} from '@seedprotocol/mapping'
import { FieldMapper, useFieldMapper } from '@seedprotocol/mapping/react'

// Rows — property-keyed (default layout; recommended)
<FieldMapper
  rowKey="property"
  sources={rssItemToSources(item)} // origin sources; no buildResolvedSourceNodes
  targets={postTargets} // e.g. { name: 'html', dataType: 'Html', required: true }
  mappings={mappings}
  onChange={setMappings}
  slots={{ lookups: 'row', preview: 'row' }}
  renderRowAccessory={(row) =>
    row.mapping?.resolve === 'extract' || row.mapping?.resolve === 'file'
      ? <button type="button">Preview</button>
      : null
  }
  renderLookup={(row) => (
    <IdentityLookup
      sampleValue={row.sampleValue}
      entries={row.mapping?.lookup?.entries ?? []}
      onChange={row.onLookupChange}
    />
  )}
  renderRowExpansion={(row) =>
    row.mapping?.resolve === 'assemble' ? <AssembleStack row={row} /> : null
  }
  transformOptions={(row, defaults) =>
    row.target?.name === 'slug'
      ? [...defaults, { value: 'derive', label: 'from title' }]
      : defaults
  }
/>

// Rows — source-keyed
<FieldMapper rowKey="source" sources={itemSources} targets={targets} mappings={mappings} onChange={setMappings} />

// Wires (deprecated — opt in explicitly)
<FieldMapper
  layout="wires"
  sources={buildResolvedSourceNodes(markdownToSources(markdown))}
  targets={targets}
  mappings={mappings}
  onChange={setMappings}
  theme="none"
/>
```

Headless mechanics (same package):

```tsx
const mapper = useFieldMapper({
  sources,
  targets,
  mappings,
  onChange: setMappings,
  rowKey: 'property',
})
// mapper.rows, mapper.coverage, mapper.setSource, mapper.setTransform, …
```

Connecting a source to a Relation / List-of-Relation target sets `resolve: 'lookup'`.
Pass `renderLookup` to paint the host picker (Identity, etc.) on that row. Without
`renderLookup`, `onLookupsChange` still enables the package uid-text fallback.
`lookups` / `onLookupsChange` are deprecated — persist `lookup.entries` on the edge.

Row and JSON previews match sync `applyMapping` output. Lookup hits appear in the
bag; extract/file/derive/assemble stay under `_pendingResolve`. JSON sits behind a disclosure.

`derive` and `assemble` are first-class resolve words. The package persists the
keys and treats a source-less derive edge as mapped. Hosts own apply (`slugify`,
named-block HTML) and product labels (e.g. **from title** via `transformOptions`).
Do not invent a leftover source named “from title”. Package `autoMap` does not
default html to assemble.

**Theming**

| Prop | Behavior |
|------|----------|
| `theme="default"` (default) | Injects structural + paint CSS once into `document.head` (`@layer seed-field-mapper`) with `--sfm-*` tokens (`--fm-*` aliases kept for one minor) |
| `theme="structural"` | Layout / spacing only — no color paint; inherits host colors |
| `theme="none"` | No injection — structural classes only (`fm-card`, `fm-row`, `fm-grid`, …); keeps `seed-field-mapper--unstyled` |
| `theme="unstyled"` | **Deprecated** shim for `none` |
| `classNames` | Per-slot host classes merged with package classes (`root`, `toolbar`, `row`, `rowAccessory`, …) |
| `components` | Optional host `Select` / `Button` / `Pill` (defaults are native controls) |
| `slots` | Toggle chrome: `autoMap`, `filter`, `inspector`, `preview` (`'row' \| 'json' \| 'both' \| false`), `lookups` (`'row' \| 'section' \| false`; rows layout defaults to `'row'`, wires to `'section'`) |
| `renderRowAccessory` | Optional `(row: FieldMapperRow) => ReactNode` for host chrome (e.g. extract/file **Preview**) in `.fm-row-accessory`. Unrelated to `slots.preview`. Package does not fetch. |
| `renderLookup` | Optional `(row: FieldMapperLookupRow) => ReactNode` for host lookup chrome on `resolve: 'lookup'` rows. Package does not fetch or list identities. |
| `renderRowExpansion` | Optional `(row: FieldMapperRow) => ReactNode` under the row (e.g. host assemble stack) in `.fm-row-expansion`. |
| `transformOptions` | Optional `(row, defaults) => options` to add or relabel transforms (e.g. **from title** on slug). Defaults: copy / extract / file / lookup, plus assemble on `Html` targets. |
| `showPreview` | **Deprecated** — prefer `slots.preview` |
| `connectionColors` | **Deprecated** optional stroke palette for wires; prefer `--sfm-map-*` / `--fm-map-*` / `--map-*` |
| `layout="wires"` | **Deprecated** — prefer `layout="rows"` (now the default) |

`SourceNode` may include optional `subtitle` (display-only). Prefer `subtitle` over stuffing a secondary fact into `label` (e.g. origin field name on a resolved well).

**DOM hooks for host CSS**

- Wires: mapped wells expose `data-mapping-index` / `data-pair={index % 8}` (kept for host CSS); pending `.active` only on the selected source.
- Rows: `data-state="empty|mapped|needsResolve|needsLookup|conflict"`, `data-property-name`, `data-resolve`, `data-required`, `data-source-kind`.

Sync `applyMapping` preview lists pending **extract/file/derive/assemble** edges under `_pendingResolve`. Lookup refs from stored entries appear in the bag.

See [FIELD_MAPPER_REDESIGN.md](../../docs/FIELD_MAPPER_REDESIGN.md) for the row-layout design study (Phases 1–5 shipped). PermaPress: [FIELD_MAPPER_PERMAPRESS_HANDOFF.md](../../docs/FIELD_MAPPER_PERMAPRESS_HANDOFF.md).

## Relationship to `FeedFieldManifest`

| Type | Package | Meaning |
|------|---------|---------|
| `FieldMapping` / `MappingDocument` | `@seedprotocol/mapping` | Source id (optional) → **model property name** (1→N edges; optional `resolve`; optional `lookup.entries` / `derive` / `assemble`) |
| `FeedFieldManifest` | `@seedprotocol/sdk` | Property/key → **role** (`image` / `audio` / `video` / `file` / `html` / `text`) for display |

Compose them: map + resolve into a plain item, then optionally normalize roles for media/HTML display. Storage stays `Image` / `File` schema types — no separate Audio/Video dataTypes.

## Limits

- Markdown: flat YAML frontmatter; `#` / `##` sections only
- RSS: top-level item fields via `parseRssString` (no general XPath); structured enclosure / media:content
- UI: self-contained dark theme (or `theme="none"` / `"structural"` for host paint); `layout` defaults to `rows` (`wires` deprecated); no desktop/Tailwind coupling; no media preview player

See [MAPPING_PHASE2.md](../../docs/MAPPING_PHASE2.md) for remaining consumer work (desktop migration, npm publish), [FIELD_MAPPER_REDESIGN.md](../../docs/FIELD_MAPPER_REDESIGN.md) for the row-layout study, and [FIELD_MAPPER_PERMAPRESS_HANDOFF.md](../../docs/FIELD_MAPPER_PERMAPRESS_HANDOFF.md) for PermaPress.
