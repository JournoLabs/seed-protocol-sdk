# Pages agents can read

An assistant or crawler that reaches a Seed publication reads it best as plain text with the
provenance attached. Three outputs cover that, and a site serves them beside its HTML pages:

| Output | URL we suggest | Built with |
|---|---|---|
| An index of the publication | `/llms.txt` | `llmsTxt`, `llmsTxtItemLinks` from `@seedprotocol/feed` |
| Each item as Markdown | the item's URL with `.md` added, e.g. `/posts/a-post.md` | `itemMarkdown` from `@seedprotocol/feed` |
| Each item's graph in its HTML page | a `<script>` in the page's `<head>` | `exportSeeds`, `toJsonLd`, `jsonLdScript` from `@seedprotocol/rdf` |

The `.md` suffix and `/llms.txt` follow the [llms.txt proposal](https://llmstxt.org). Agents look
there first, so a site that uses other paths should still link them from `/llms.txt`.

An agent that runs tools instead of browsing can read the same content, without a website, through
[`@seedprotocol/mcp`](../packages/mcp/README.md), which Claude Code installs as the
[Seed Protocol plugin](../plugins/seed-protocol/README.md).

## An item as Markdown

```ts
import { getSeed } from '@seedprotocol/query'
import { itemMarkdown } from '@seedprotocol/feed'

const record = await getSeed(seedUid)
if (record) {
  const markdown = itemMarkdown(record, {
    url: 'https://news.example/posts/a-post',
    license: {
      name: 'CC-BY-4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      summary: 'Anyone may republish and adapt it with credit.',
    },
  })
  // Serve with Content-Type: text/markdown; charset=utf-8
}
```

The Markdown opens with YAML front matter, then the title as a `#` heading and the body:

```markdown
---
title: "A post"
seed_uid: "0x5a1c…"
version_uid: "0x9e02…"
attester: "0x1111…"
schema: "post"
published: "2025-11-13T02:13:20.000Z"
authors:
  - "Ada Example"
summary: "What happened"
url: "https://news.example/posts/a-post"
license: "CC-BY-4.0"
license_url: "https://creativecommons.org/licenses/by/4.0/"
license_summary: "Anyone may republish and adapt it with credit."
---

# A post

Body text…
```

A field with no value is left out. `published` is when the Seed was attested. The attester is the
address the reader should check against the publication's own; anyone can attest under a public
schema, so `seed_uid` alone doesn't show who published an item.

The body is the record's rich body field, chosen as feeds choose it (see
[FEED_RICH_FIELDS.md](FEED_RICH_FIELDS.md#publishing-feeds-seed--rss--atom--json)). HTML is
converted to Markdown with these changes:

- `script`, `style`, `noscript` and `iframe` elements are dropped.
- Tables stay HTML. Markdown has no table syntax that holds merged cells.
- An image embedded as a `data:` URI becomes `[image: alt]`, so its bytes aren't in the text.
- Arweave links point at the public gateway, as in feeds.

Read the record with `hydrateStorage` on (the default for `getSeed` and `queryBySchema`). With it
off, the body is an Arweave URL rather than the text.

The SDK doesn't read licence offers from EAS yet, so the licence comes from the caller.
`summarySentence` in `@seedprotocol/licensing` gives the one-line summary for terms you hold.

`htmlToMarkdown(html)` is exported on its own for other HTML.

## llms.txt

```ts
import { queryBySchema } from '@seedprotocol/query'
import { llmsTxt, llmsTxtItemLinks } from '@seedprotocol/feed'

const { items } = await queryBySchema('post', { limit: 50, attesters: [PUBLISHER] })

const body = llmsTxt({
  title: 'Example News',
  description: 'Local reporting from Example County.',
  details: `Articles are attested with EAS by ${PUBLISHER} and stored on Arweave. Each article's Markdown gives its seed UID, version UID and attester.`,
  sections: [
    { name: 'Latest articles', links: llmsTxtItemLinks(items, (r) => `https://news.example/posts/${slugFor(r)}.md`) },
    { name: 'Feeds', links: [{ title: 'JSON Feed', url: 'https://news.example/feed.json' }] },
    { name: 'Archive', optional: true, links: archiveLinks },
  ],
})
// Serve at /llms.txt with Content-Type: text/plain; charset=utf-8
```

`llmsTxtItemLinks` titles each link with the item's title, or its seed UID when it has none, and
adds its summary. Sections marked `optional` go under one `## Optional` heading at the end, which
agents with little room skip. A section with no links is left out.

Pass `attesters` when listing. Without it, `queryBySchema` returns every seed under the schema,
including ones other wallets attested.

## JSON-LD in an item's page

```ts
import { exportSeeds, jsonLdScript, toJsonLd } from '@seedprotocol/rdf'

const graph = await exportSeeds([seedUid], {
  chainId: 10,
  contentUrl: (tx) => `https://arweave.net/${tx}`,
  lens: { schema, sidecar },
})
const tag = jsonLdScript(toJsonLd(graph))
// Put `tag` in the page's <head>.
```

With a lens whose sidecar maps your models and properties to schema.org terms (`seed-rdf suggest`
proposes some, such as `schema:Article` for a model named `article`), the graph uses those terms,
which search engines and agents already know. Without a lens it uses Seed's own vocabulary. `jsonLdScript` escapes `<`, `>` and `&` so no
value can end the `<script>` element. The graph's IRIs use the provisional base described in the
[rdf README](../packages/rdf/README.md); a page is replaced on the next render, so that is safe
here, unlike in an archive.
