# Changelog

## Unreleased

- `FieldMapper`: `theme="default" | "unstyled"`, CSS-var connector strokes (`--fm-map-1…8` / `--map-1…8`), optional `connectionColors`, `data-mapping-index` / `data-pair` on wells and paths; pending `.active` only on the selected source.
- `FieldMapping.resolve?: 'extract' | 'file'`; sync `applyMapping` skips resolve edges; new `applyMappingAsync` with host callback.
- `classifyUrl`, `buildResolvedSourceNodes`, `normalizeMappingFromSourceId` for package-owned extract/file candidates.
- RSS adapter exposes enclosure / media:content as `url` + `contentType` in `meta` (stable `rss-enclosure-N` ids).
- `autoMap` never maps a raw URL onto html/Image/File without `resolve`; prefers full-text → html, then extract, then file jobs.
- Allow one source to map to multiple properties (edge-list fan-out); each property remains exclusive.
- `autoMap` fans `link` / `url` sources out to matching URL-ish targets (`importUrl`, `canonicalUrl`, `url`, `link`, `permalink`).
- `FieldMapper` supports attaching multiple properties from an active source without clearing prior edges; normalizes `@extract`/`@file` nodes to `resolve` on persist.

## 0.5.1

- Initial Phase 1 release: headless mapping core, markdown + RSS adapters, `FieldMapper` UI.
