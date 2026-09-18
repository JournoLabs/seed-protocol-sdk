# @seedprotocol/mapping

Source → Seed model property mapping helpers and a props-driven React UI.

Use this package to:

1. Parse markdown or RSS/Atom into `SourceNode[]`
2. Optionally expand URL sources with `buildResolvedSourceNodes` (extract / file candidates)
3. Author `FieldMapping` edges (manually, via `autoMap`, or via `FieldMapper`)
4. `applyMapping` (sync copy) or `applyMappingAsync` (host resolve callback) → property bag

Mappings are an edge list: one source may fan out to multiple properties (e.g. RSS
`link` → `importUrl` and `canonicalUrl`). Each property is exclusive — at most one
source may map to it. Optional `resolve: 'extract' | 'file'` marks URL transforms the
**host** performs; the package never fetches or runs Readability.

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
    resolve: async ({ job, url, contentType }) => {
      if (job === 'extract') return await hostExtractHtml(url)
      return await hostFetchAndStoreFile(url, contentType)
    },
  },
)
```

`classifyUrl({ url, contentType? })` is a pure MIME/extension classifier
(`html` | `image` | `audio` | `video` | `unknown`). Enclosure nodes expose
`meta.url`, `meta.contentType`, and `meta.class` (not a stringified object).

## FieldMapper UI

Props-driven only — no Seed hooks or routing. Pass expanded sources so extract/file
candidates appear in the left pane; connecting them persists `resolve` on the edge.

```tsx
import { useState } from 'react'
import {
  FieldMapper,
  buildResolvedSourceNodes,
  markdownToSources,
  applyMapping,
  applyMappingAsync,
  type FieldMapping,
} from '@seedprotocol/mapping'

function ImportMap({ markdown, targets, onSubmit }) {
  const sources = buildResolvedSourceNodes(markdownToSources(markdown))
  const [mappings, setMappings] = useState<FieldMapping[]>([])

  return (
    <>
      <FieldMapper
        sources={sources}
        targets={targets}
        mappings={mappings}
        onChange={setMappings}
      />
      <button
        onClick={async () => {
          const { properties } = await applyMappingAsync(
            sources,
            mappings,
            targets,
            { resolve: hostResolve },
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

Sync `applyMapping` preview lists pending resolve edges under `_pendingResolve`.

## Relationship to `FeedFieldManifest`

| Type | Package | Meaning |
|------|---------|---------|
| `FieldMapping` / `MappingDocument` | `@seedprotocol/mapping` | Source id → **model property name** (1→N edges; optional `resolve`) |
| `FeedFieldManifest` | `@seedprotocol/sdk` | Property/key → **role** (`image` / `audio` / `video` / `file` / `html` / `text`) for display |

Compose them: map + resolve into a plain item, then optionally normalize roles for media/HTML display. Storage stays `Image` / `File` schema types — no separate Audio/Video dataTypes.

## Phase 1 limits

- Markdown: flat YAML frontmatter; `#` / `##` sections only
- RSS: top-level item fields via `parseRssString` (no general XPath); structured enclosure / media:content
- UI: self-contained dark theme; no desktop/Tailwind coupling; no media preview player

See [MAPPING_PHASE2.md](../../docs/MAPPING_PHASE2.md) for consumer migration and hardening.
