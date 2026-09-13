# @seedprotocol/mapping

Source → Seed model property mapping helpers and a props-driven React UI.

Use this package to:

1. Parse markdown or RSS/Atom into `SourceNode[]`
2. Author 1:1 `FieldMapping`s (manually, via `autoMap`, or via `FieldMapper`)
3. `applyMapping` to a coerced property bag for `createItem` / publish

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

RSS:

```ts
const { channel, items } = await rssXmlToSources(xml)
const itemSources = items[0]!
const mappings = autoMap(itemSources, postTargets)
const properties = applyMapping(itemSources, mappings, postTargets)
```

## FieldMapper UI

Props-driven only — no Seed hooks or routing. The host app supplies sources/targets and handles create/navigate.

```tsx
import { useState } from 'react'
import {
  FieldMapper,
  markdownToSources,
  applyMapping,
  type FieldMapping,
} from '@seedprotocol/mapping'

function ImportMap({ markdown, targets, onSubmit }) {
  const sources = markdownToSources(markdown)
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
        onClick={() => onSubmit(applyMapping(sources, mappings, targets))}
      >
        Create
      </button>
    </>
  )
}
```

## Relationship to `FeedFieldManifest`

| Type | Package | Meaning |
|------|---------|---------|
| `FieldMapping` / `MappingDocument` | `@seedprotocol/mapping` | Source id → **model property name** |
| `FeedFieldManifest` | `@seedprotocol/sdk` | Property/key → **role** (`image` / `html` / `text`) for `normalizeFeedItemFields` |

Compose them: map external fields into a plain item, then optionally normalize roles for media/HTML display.

## Phase 1 limits

- Markdown: flat YAML frontmatter; `#` / `##` sections only
- RSS: top-level item fields via `parseRssString` (no general XPath)
- UI: self-contained dark theme; no desktop/Tailwind coupling

See [MAPPING_PHASE2.md](../../docs/MAPPING_PHASE2.md) for consumer migration and hardening.
