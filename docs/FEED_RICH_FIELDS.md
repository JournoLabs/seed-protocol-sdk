# Feed and XML rich fields

This guide explains how to turn RSS/XML strings (feature images, content, seed references) into data and UI in a Seed app.

## Layers

1. **Classification (sync)** — `classifyMediaRef(raw)` in `@seedprotocol/sdk` inspects a string and returns a structured kind: URL, seed UID, local seed id, Arweave transaction id, or unknown. No I/O.

2. **Normalization (sync)** — `normalizeFeedItemFields(item, manifest)` maps named fields on a plain item object using a small manifest (`image`, `file`, `html`, `text` roles). For media roles it attaches the result of `classifyMediaRef`. HTML and text are passed through as strings only; **the SDK does not sanitize HTML**.

3. **Resolution (async)** — `resolveMediaRef(raw)` produces a display URL when possible:

   - **https / blob / data URLs** — returned as-is (`source: 'direct'`).
   - **Arweave tx id** — if the file exists in local image storage, a blob URL is returned (`source: 'localBlob'`); otherwise a gateway raw URL is used (`source: 'gateway'`).
   - **Seed UID** — requires an initialized app database with metadata that links the UID to `storageTransactionId`; then the same local-vs-gateway rule applies as for a tx id.
   - **Local seed id** (10–21 character ref) — **not portable** across devices; resolution returns `unresolved` with reason `seed_local_id_not_portable`.

4. **RSS parsing (async, optional)** — `@seedprotocol/feed` provides `parseRssString(xml)` (via `rss-parser`) returning channel fields and plain item records. You can also use any other parser and still use `normalizeFeedItemFields` / `resolveMediaRef` on the objects you get.

## Package entry points

| Capability | Package | API |
|------------|---------|-----|
| Classify / resolve / normalize | `@seedprotocol/sdk` | `classifyMediaRef`, `resolveMediaRef`, `normalizeFeedItemFields`, `getFeedItemStringField` |
| Parse RSS/XML | `@seedprotocol/feed` | `parseRssString` (also re-exports the SDK helpers above) |
| Publish RSS/Atom/JSON | `@seedprotocol/feed` | `createFeed`, `pickFeedItemContent`, `pickFeedItemDescription`, `feedItemRichTextContainsDataUriImage` |
| React | `@seedprotocol/react` | `useResolvedMediaRef`, `SeedMediaImage`, `SeedMediaFile`, `SeedHtml`, `SeedJson`, `formatSeedJson`, `useNormalizedFeedItemFields` |

React apps do **not** need to depend on `@seedprotocol/feed` unless they parse RSS in the browser or on a server that already uses the feed package.

## Publishing feeds (Seed → RSS / Atom / JSON)

When `@seedprotocol/feed` builds a feed from GraphQL/EAS-assembled items (via `createFeed` and the internal `transformToFeedItems` step), `getFeedItemsBySchemaName` first annotates relation-backed fields with storage model metadata, then rich body is resolved in this order:

1. **Typed storage relations** — Fields listed in `_feedFieldStorageModels` / `_feedListElementStorageModels` whose related Seed schema is `html`, `file`, or `json` (case-insensitive). Among those, the chosen value is deterministic: model priority **html**, then **file**, then **json**; ties break by field name (lexical), then list index. For list relations, only elements typed as one of those three are candidates.
2. **Legacy body / HTML fields** — `html`, `Html`, `body`, `Body`, `content`, `Content` (first non-empty string wins).
3. **Fallbacks** — `summary`, `description`, `text` (and capitalized variants), same order as legacy behavior.

Items that never pass through `getFeedItemsBySchemaName` (for example hand-built GraphQL shapes) keep **only** steps 2–3 unless you attach the `_feed*` maps yourself.

**Short text for excerpts** uses only `summary`, `description`, and `text` (and capitalized variants), not `body` / `html`, so a typical article can keep a **summary** separate from full **body** HTML.

That resolved string becomes feed **`content`**, which serializes to:

- **RSS 2.0** — `content:encoded` (Content Module namespace).
- **JSON Feed** — `content_html`.
- **Atom** — entry `content`.

**Trust:** feed generation **does not sanitize HTML**. Published feeds contain the same strings as stored or assembled on the wire; sanitization is the app’s policy. For **untrusted** imported RSS/XML, sanitize when you ingest or when you render (see below). For **first-party** content, many apps sanitize only at **render** time (`SeedHtml` requires a `sanitize` callback). See [GETTING_STARTED.md – Displaying Html properties](GETTING_STARTED.md#displaying-html-properties).

You can reuse the same resolution rules in your own code with **`pickFeedItemContent`** and **`pickFeedItemDescription`** from `@seedprotocol/feed`.

### Embedded `data:image/` URIs (breaking default)

Feeds that include full HTML with inline `data:image/...;base64,...` URIs can produce **very large** RSS/Atom/JSON payloads. By default, `createFeed` **drops** those items before serialization.

- **Default:** `richTextDataUriImages: 'omit_items'` (applied inside `transformToFeedItems`).
- **Site-wide opt-in:** set env **`FEED_INCLUDE_DATA_URI_HTML_ITEMS=true`** so `loadFeedConfig()` returns `richTextDataUriImages: 'include_items'` and those entries are kept.
- **Per call:** pass the 9th argument to `createFeed`: `transformOverrides` with `{ richTextDataUriImages: 'include_items' }` (overrides env for that generation).
- **Detection helper:** `feedItemRichTextContainsDataUriImage(item)` scans the same sources as `pickFeedItemContent` (typed `html` / `file` / `json` fields and list slots when `_feed*` maps are present, then the legacy primary keys) plus excerpt keys (`summary`, `description`, `text` and capitalized variants) and requires both `data:image/` and `;base64,` in the string.

If you publish HTML with embedded images, prefer **materialized** Image seeds and normal `https://` or Arweave URLs in stored HTML (see publish docs for `htmlEmbeddedDataUriPolicy` and two-phase L1 upload). Items that still contain data-URI images after publish remain eligible for omission unless you opt in as above.

## Field manifest example

```ts
import type { FeedFieldManifest } from '@seedprotocol/sdk'

const manifest: FeedFieldManifest = {
  featureImage: { role: 'image' },
  content: { role: 'html' },
  summary: { role: 'text' },
}
```

If a value is ambiguous (e.g. heuristic collision), set `treatAs` on the descriptor or pass `treatAs` into `resolveMediaRef` / `useResolvedMediaRef`:

```ts
{ featureImage: { role: 'image', treatAs: 'arweaveTx' } }
```

## Recipes

### Parse RSS and normalize fields

```ts
import { parseRssString, normalizeFeedItemFields } from '@seedprotocol/feed'

const { items } = await parseRssString(xml)
for (const item of items) {
  const row = item as Record<string, unknown>
  const n = normalizeFeedItemFields(row, manifest)
  // n.featureImage?.classification, n.content?.raw, etc.
}
```

### Resolve a hero image URL in React

```tsx
import { useResolvedMediaRef, SeedMediaImage } from '@seedprotocol/react'

function Hero({ featureImage }: { featureImage: string }) {
  const { href, status, error } = useResolvedMediaRef({ value: featureImage })
  if (status === 'loading') return <p>Loading…</p>
  if (error || status === 'unresolved') return null
  return href ? <img src={href} alt="" /> : null
}
```

Or use the built-in component:

```tsx
<SeedMediaImage value={featureImage} alt="Cover" className="rounded" />
```

### Custom `<img>` (render prop)

```tsx
<SeedMediaImage
  value={featureImage}
  alt="Cover"
  render={(props) => <img {...props} className="my-img" />}
/>
```

### File attachment / enclosure URL

Treat the field as `file` in the manifest (same classification pipeline as `image`). The normalized field is a **`NormalizedMediaField`** with `role: 'file'` plus `classification` from `classifyMediaRef`. Pass **`raw`** into **`SeedMediaFile`** so it resolves like a hero image and renders a link by default.

```tsx
import { SeedMediaFile, useNormalizedFeedItemFields } from '@seedprotocol/react'
import type { FeedFieldManifest } from '@seedprotocol/sdk'

const manifest: FeedFieldManifest = {
  attachment: { role: 'file' },
}

function EnclosureLink({ item }: { item: Record<string, unknown> }) {
  const n = useNormalizedFeedItemFields(item, manifest)
  const f = n.attachment
  const raw = f && f.role === 'file' ? f.raw : undefined
  return (
    <SeedMediaFile
      value={raw}
      download
    >
      Download
    </SeedMediaFile>
  )
}
```

Use **`children`** for i18n-friendly labels; omit **`children`** to use a short default derived from the URL path. For loading or unresolved states, use **`useResolvedMediaRef`** and branch on **`status`**.

### JSON-looking text fields

The manifest has no dedicated `json` role today. If a feed exposes JSON as a string (often alongside `text`), **`JSON.parse`** in a try/catch, then render the result with **`SeedJson`** or **`formatSeedJson`** from `@seedprotocol/react` (read-only; do not **`eval`**). For local `Json` item properties, see [GETTING_STARTED.md – Json properties](GETTING_STARTED.md#json-properties).

### HTML content (`content:encoded`)

Treat the field as `html` in the manifest for typing only. **Sanitize before rendering** (for example with a trusted HTML sanitizer); never pipe raw feed HTML into `dangerouslySetInnerHTML` without sanitization.

**React:** After `useNormalizedFeedItemFields(item, manifest)`, an HTML field is a `NormalizedHtmlField`: `{ role: 'html', raw: string }` (type exported from `@seedprotocol/sdk`). Pass `field.raw` into **`SeedHtml`** from `@seedprotocol/react` with the same required **`sanitize`** callback you use for `Html` item properties. Example:

```tsx
import DOMPurify from 'dompurify'
import { SeedHtml, useNormalizedFeedItemFields } from '@seedprotocol/react'
import type { FeedFieldManifest } from '@seedprotocol/sdk'

const manifest: FeedFieldManifest = {
  content: { role: 'html' },
}

function FeedEntryBody({ item }: { item: Record<string, unknown> }) {
  const n = useNormalizedFeedItemFields(item, manifest)
  const htmlField = n.content
  const raw = htmlField?.role === 'html' ? htmlField.raw : undefined
  return (
    <SeedHtml
      html={raw}
      sanitize={(h) => DOMPurify.sanitize(h)}
    />
  )
}
```

For local items and `useItemProperty`, see [GETTING_STARTED.md – Displaying Html properties](GETTING_STARTED.md#displaying-html-properties).

### List relation properties (e.g. authors)

When the feed server loads related seeds and `expandRelations` is enabled in feed config, list-of-relation fields (such as `authorIdentityIds` on the wire) are expanded to the public schema key (`authors`) with an **array of plain objects**—one per related item—so RSS can emit nested elements (for example repeated `<author>` with child fields like `<displayName>`). Storage-style keys that map to the same relation are removed from the serialized item so XML does not duplicate IDs alongside nested content. Related items that only have an Arweave `storageTransactionId` are still surfaced as URL lists instead of full object expansion.

## `SeedImage` vs `SeedMediaImage`

- **`SeedImage`** — tied to a synced **`ItemProperty`** (local DB, file paths, sized variants). Use in editors and first-party apps where items already live in the Seed client.

- **`SeedMediaImage`** / **`useResolvedMediaRef`** — for **opaque strings** from RSS/XML or other feeds: URLs, tx ids, or seed UIDs. They do not require an `ItemProperty` instance.

## Limitations

- No automatic sync of remote seeds; a seed UID only resolves if your local DB has the right metadata.
- **Local seed ids** in a feed are usually meaningless on another device.
- **Unknown** strings stay unresolved until you add a `treatAs` override or change what the feed publishes.
- Gateway URLs work without local files but depend on Arweave gateway availability.
