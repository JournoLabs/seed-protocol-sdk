# Changelog

## 0.7.0

- Relation lookup is an edge-local stored intent: `FieldMapping.lookup.entries` as `{ value, ref }[]`. `ref` is opaque (`seedLocalId` or `seedUid`). Empty entries are a valid unassigned map.
- `applyMapping` (sync) applies lookup entries and emits refs. Unmatched values are omitted. `applyMappingAsync` reports unmatched on `errors[]` and no longer calls the host `resolve` callback for lookup.
- `autoMap` pairs alias matches such as `author` → List-of-Relation `authors` with `resolve: 'lookup'` and no invented refs.
- `FieldMapper` `renderLookup?: (row: FieldMapperLookupRow) => ReactNode` — host picker on lookup rows (same split as `renderRowAccessory`). Package uid editor is a fallback only.
- `useFieldMapper.setLookupEntries`. Row `sampleValue` and `data-state="needsLookup"` when the current sample has no matching entry.
- `TargetProperty` stays Seed-accurate (`List` + `refValueType: 'Relation'` + `ref`). No `multiple` flag.
- `MappingDocument.lookups` / `lookups` + `onLookupsChange` are deprecated read/write fallbacks for 0.6.0 documents.
- `_pendingResolve` is extract/file only; lookup hits appear in the preview bag.

## 0.6.1

- `FieldMapper` `renderRowAccessory?: (row: FieldMapperRow) => ReactNode` — host chrome slot on each rows-layout row (`.fm-row-accessory` / `classNames.rowAccessory`), after the transform control and before remove. Package does not fetch or preview; hosts return `null` when idle (e.g. show **Preview** only for `resolve: 'extract' | 'file'`).
- Optional `SourceNode.subtitle` for a secondary display line (inspector, wires card, source option labels). Prefer this over stuffing origin into `label`. Display-only — not part of `MappingDocument`.

## 0.6.0

- `FieldMapper` Phase 5: `layout` defaults to `'rows'`; `'wires'` is deprecated but still supported.
- `FieldMapper` Phase 4: per-row lookup editors (`slots.lookups: 'row'`), row/JSON preview parity with sync `applyMapping` (+ `_pendingResolve`), JSON behind a `<details>` disclosure. Rows layout defaults `lookups` to `'row'`; wires keep `'section'`.
- Shared `LookupEditor` + `buildSyncPreviewBag` / upgraded `previewForEdge` (lookup table hits, coerced copy values).
- `FieldMapper` Phase 3 theming contract: `--sfm-*` tokens (with `--fm-*` aliases), `theme="default" | "structural" | "none"` (`unstyled` shim), `classNames` / `components` / `slots`, `@layer seed-field-mapper`, document-once CSS injection, row `data-source-kind`.
- Deprecated (still work): `layout="wires"`, `theme="unstyled"`, `showPreview`, `connectionColors` — prefer `layout="rows"`, `theme="none"`, `slots.preview`, and CSS map tokens.
- `FieldMapper` row layout (Phase 1–2 of the redesign): `layout="rows" | "wires"`, `rowKey="property" | "source"`, `defaultRows`, optional `TargetProperty.required` for coverage.
- Headless `useFieldMapper` hook + shared core (`setSource` / `setTransform` / coverage / conflicts); wires UI refactored to consume the hook.
- Rows UI: transform control on the edge (no `buildResolvedSourceNodes` in the rows path), coverage toolbar, mapped+required filter, add-mapping flow, source inspector; source mode conflict + coverage banners.
- **Breaking:** `FieldMapper` and related UI exports moved to `@seedprotocol/mapping/react`. The default entry is headless-only (no React import or required peer) so Node sidecars can load without React. Install `react` / `react-dom` only when using `/react`.
- **Breaking:** `FieldMapper` `layout` default flipped from `'wires'` to `'rows'`. Pass `layout="wires"` explicitly if you still need the two-pane connector UI. For rows, pass origin sources only (not `buildResolvedSourceNodes`).
- `resolve: 'lookup'` for Relation / List-of-Relation targets: persistable `MappingDocument.lookups` (string → seed uid), `applyMappingAsync` table hit + optional host callback on miss; sync apply skips lookup edges.
- `TargetProperty.ref` / `refValueType`; `isRelationLookupTarget` helper; `autoMap` never plain-copies onto lookup-capable targets (author → authors no longer writes a string into a relation list).
- `FieldMapper`: connecting to a lookup-capable target sets `resolve: 'lookup'`; optional `lookups` / `onLookupsChange` panel edits string → uid maps (comma-separated for multi).
- `FieldMapper`: `theme="default" | "unstyled"`, CSS-var connector strokes (`--fm-map-1…8` / `--map-1…8`), optional `connectionColors`, `data-mapping-index` / `data-pair` on wells and paths; pending `.active` only on the selected source.
- `FieldMapping.resolve?: 'extract' | 'file' | 'lookup'`; sync `applyMapping` skips resolve edges; new `applyMappingAsync` with host callback.
- `classifyUrl`, `buildResolvedSourceNodes`, `normalizeMappingFromSourceId` for package-owned extract/file candidates.
- RSS adapter exposes enclosure / media:content as `url` + `contentType` in `meta` (stable `rss-enclosure-N` ids).
- `autoMap` never maps a raw URL onto html/Image/File without `resolve`; prefers full-text → html, then extract, then file jobs.
- Allow one source to map to multiple properties (edge-list fan-out); each property remains exclusive.
- `autoMap` fans `link` / `url` sources out to matching URL-ish targets (`importUrl`, `canonicalUrl`, `url`, `link`, `permalink`).
- `FieldMapper` supports attaching multiple properties from an active source without clearing prior edges; normalizes `@extract`/`@file` nodes to `resolve` on persist.

## 0.5.1

- Initial Phase 1 release: headless mapping core, markdown + RSS adapters, `FieldMapper` UI.
