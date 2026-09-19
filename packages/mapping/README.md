# @seedprotocol/mapping

Source → Seed model property mapping helpers and a props-driven React UI.

Use this package to:

1. Parse markdown or RSS/Atom into `SourceNode[]`
2. Optionally expand URL sources with `buildResolvedSourceNodes` (extract / file candidates)
3. Author `FieldMapping` edges (manually, via `autoMap`, or via `FieldMapper`)
4. `applyMapping` (sync copy) or `applyMappingAsync` (host resolve callback) → property bag

Mappings are an edge list: one source may fan out to multiple properties (e.g. RSS
`link` → `importUrl` and `canonicalUrl`). Each property is exclusive — at most one
source may map to it. Optional `resolve: 'extract' | 'file' | 'lookup'` marks
transforms the **host** (or a persisted value map) performs; the package never
fetches, runs Readability, or loads Seed Identity items.

## Install

```bash
bun add @seedprotocol/mapping
```

Peers: `react`, `react-dom`. RSS parsing uses `rss-parser` with the same custom fields as `@seedprotocol/feed` `parseRssString` (aligned, no hard dependency on the feed package barrel).

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

// Sync preview skips resolve edges:
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
target (e.g. `authors` → Identity) via a persisted dictionary and/or host callback:

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
  { sourceId: 'rss-author', propertyName: 'authors', resolve: 'lookup' as const },
]

const doc: MappingDocument = {
  version: 1,
  sourceKind: 'rss',
  mappings,
  lookups: {
    authors: { 'Jane Doe': 'identity-seed-uid' },
  },
}

const { properties, errors } = await applyMappingAsync(
  itemSources,
  mappings,
  postTargets,
  {
    lookups: doc.lookups,
    // Optional: called only when the table has no entry for the trimmed source value
    resolve: async ({ job, rawValue }) => {
      if (job === 'lookup') return await findOrCreateIdentity(rawValue!)
      throw new Error(`unexpected job ${job}`)
    },
  },
)
// properties.authors === ['identity-seed-uid']
```

`autoMap` never wires a plain string onto Relation / List-of-Relation targets —
author those edges in FieldMapper or programmatically.

`classifyUrl({ url, contentType? })` is a pure MIME/extension classifier
(`html` | `image` | `audio` | `video` | `unknown`). Enclosure nodes expose
`meta.url`, `meta.contentType`, and `meta.class` (not a stringified object).

## FieldMapper UI

Props-driven only — no Seed hooks or routing. Pass expanded sources so extract/file
candidates appear in the left pane; connecting those nodes persists `resolve` on the edge.
Connecting a source to a Relation / List-of-Relation target sets `resolve: 'lookup'`
and (when `onLookupsChange` is provided) shows a string → seed uid editor.

```tsx
import { useState } from 'react'
import {
  FieldMapper,
  buildResolvedSourceNodes,
  markdownToSources,
  applyMappingAsync,
  type FieldMapping,
  type MappingLookups,
} from '@seedprotocol/mapping'

function ImportMap({ markdown, targets, onSubmit }) {
  const sources = buildResolvedSourceNodes(markdownToSources(markdown))
  const [mappings, setMappings] = useState<FieldMapping[]>([])
  const [lookups, setLookups] = useState<MappingLookups>({})

  return (
    <>
      <FieldMapper
        sources={sources}
        targets={targets}
        mappings={mappings}
        onChange={setMappings}
        lookups={lookups}
        onLookupsChange={setLookups}
        theme="unstyled" // host paints via CSS; or omit for built-in dark theme
        className="imprint-mapper"
        // optional: connectionColors={['#…']} — else strokes use --fm-map-1…8 / --map-1…8
      />
      <button
        onClick={async () => {
          const { properties } = await applyMappingAsync(
            sources,
            mappings,
            targets,
            { resolve: hostResolve, lookups },
          )
          onSubmit(properties)
        }}
      >
        Create
      </button>
    </>
  )
}
```

**Theming**

| Prop | Behavior |
|------|----------|
| `theme="default"` (default) | Injects CSS variables (`--fm-ground`, `--fm-ink`, `--fm-well`, `--fm-line`, `--fm-selection`, `--fm-map-1…8`) and rules |
| `theme="unstyled"` | No injected paint — structural classes only (`fm-card`, `fm-grid`, …) |
| `connectionColors` | Optional stroke palette; otherwise `stroke="var(--fm-map-N, var(--map-N, currentColor))"` |

**DOM hooks for host CSS**

- Mapped wells expose `data-mapping-index` (source may list several, space-separated) and `data-pair={index % 8}`.
- Connector paths use the same attrs.
- Pending selection: `.active` / `.pending` only on the **source** waiting for a property — targets are not flooded with `.active`.

Sync `applyMapping` preview lists pending resolve edges under `_pendingResolve`.

## Relationship to `FeedFieldManifest`

| Type | Package | Meaning |
|------|---------|---------|
| `FieldMapping` / `MappingDocument` | `@seedprotocol/mapping` | Source id → **model property name** (1→N edges; optional `resolve`; optional `lookups`) |
| `FeedFieldManifest` | `@seedprotocol/sdk` | Property/key → **role** (`image` / `audio` / `video` / `file` / `html` / `text`) for display |

Compose them: map + resolve into a plain item, then optionally normalize roles for media/HTML display. Storage stays `Image` / `File` schema types — no separate Audio/Video dataTypes.

## Phase 1 limits

- Markdown: flat YAML frontmatter; `#` / `##` sections only
- RSS: top-level item fields via `parseRssString` (no general XPath); structured enclosure / media:content
- UI: self-contained dark theme; no desktop/Tailwind coupling; no media preview player

See [MAPPING_PHASE2.md](../../docs/MAPPING_PHASE2.md) for consumer migration and hardening.
