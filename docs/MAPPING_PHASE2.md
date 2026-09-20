# Mapping package — Phase 2 handoff

This document continues work started in **Phase 1** (`@seedprotocol/mapping` on branch `feature/mapping-package-phase1`). Use it as the entry prompt for a new chat thread.

## What Phase 1 shipped

Package: [`packages/mapping`](../packages/mapping)

- **Headless:** `SourceNode`, `FieldMapping`, `MappingDocument`, `applyMapping`, `autoMap`
- **Adapters:** `markdownToSources`, `rssItemToSources`, `rssXmlToSources` (`rss-parser`, field set aligned with `@seedprotocol/feed` `parseRssString`)
- **UI:** props-driven `FieldMapper` via `@seedprotocol/mapping/react` (no `useCreateItem`, no router); default entry is headless-only
- **Monorepo:** `build:mapping`, `publish:mapping`, sync-versions / publish-package wiring
- **Not done:** npm publish, desktop migration, PermaPress feed-map UI

`FieldMapping` (source → property) stays separate from `FeedFieldManifest` (property → role). See package README.

## Phase 2 goals

### 1. Migrate seed-protocol-desktop `/import/map`

- Replace local [`MarkdownMapper.tsx`](../../seed-protocol-desktop/src/renderer/components/Mapper/MarkdownMapper.tsx) with `@seedprotocol/mapping`
- Keep app-owned: Dexie `IMPORT_MAPPING_SESSION`, schema/model pickers, `PageContainer`, post-create `navigate`
- Wire submit: `applyMapping` → `useCreateItem` → navigate to item
- Prefer workspace / published version matching monorepo; run desktop smoke on Map to Model → Create

**Suggested verification**

- [ ] Upload `.md` → Map to Model → auto-map → create item
- [ ] Frontmatter + H1/H2 + full document still map
- [ ] Create navigates to the new item

### 2. PermaPress premium RSS → Post field map

Product context: PermaPress ADR 0089 (RSS XML fields → Post schema as first premium surface).

- Author UI using `FieldMapper` from `@seedprotocol/mapping/react` + `rssXmlToSources` / `rssItemToSources` from `@seedprotocol/mapping`
- Persist `MappingDocument` (PermaPress-held config keyed by publication seed uid — see schema-gaps)
- On new feed item: `applyMapping` → start publish run (no per-item confirm once map is connected)
- Optional: after mapping, apply `FeedFieldManifest` for `featureImage` / `html` roles

**Suggested verification**

- [ ] Map `title`, `content:encoded` / `description`, `featureImage` → Post properties
- [ ] Headless apply on a sample item matches UI preview
- [ ] Pipeline creates a sealed post from a new feed item

### 3. Hardening (as needed)

- Richer YAML / nested frontmatter; `###+` section breaks
- Nested XML / XPath beyond flat RSS item keys
- Saved-map CRUD APIs in SDK or apps
- Theme tokens / light mode; Storybook or visual tests for `FieldMapper`
- Row-based `FieldMapper` redesign — see [FIELD_MAPPER_REDESIGN.md](./FIELD_MAPPER_REDESIGN.md)
- First **npm publish**: `bun run publish:mapping` (requires `@seedprotocol/feed@sameVersion` on npm)

### 4. First publish checklist

1. Ensure version synced (`bun run sync-versions`)
2. `bun run build:mapping`
3. `cd packages/mapping && bun run test`
4. `bun run publish:mapping`

## Suggested new-thread prompt

```
Continue Phase 2 for @seedprotocol/mapping per docs/MAPPING_PHASE2.md.
Start with: <desktop migration | PermaPress feed map | publish to npm>.
Phase 1 already added packages/mapping with headless core, markdown+RSS adapters, and FieldMapper.
```

## File map (Phase 1)

| Path | Role |
|------|------|
| `packages/mapping/src/types.ts` | Core types |
| `packages/mapping/src/applyMapping.ts` | Coercion + apply |
| `packages/mapping/src/autoMap.ts` | Heuristics |
| `packages/mapping/src/adapters/markdown.ts` | Markdown sources |
| `packages/mapping/src/adapters/rss.ts` | RSS/XML sources |
| `packages/mapping/src/react.ts` | `@seedprotocol/mapping/react` barrel |
| `packages/mapping/src/react/FieldMapper.tsx` | UI |
| `packages/mapping/README.md` | Consumer docs |
| `docs/MAPPING_PHASE2.md` | This handoff |
