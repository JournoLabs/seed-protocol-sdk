# Changelog

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)

## 0.6.3 (2026-09-25)

_Also covers 0.6.1, 0.6.2, published from commits in this range._

_Written as mapping 0.8.0._

- `ResolveJob` adds `'derive' | 'assemble'`. `FieldMapping.sourceId` is optional so a derive-only edge is legal.
- Persist `derive?: { from: string; fallback?: boolean }` and `assemble?: { blocks: string[] }` on the edge. Mutators pass them through, including copy + `derive` fallback. Empty `sourceId` is omitted.
- Coverage and `data-state` treat source-less `resolve: 'derive'` as mapped. `resolve: 'assemble'` does not flag `needs extract`.
- `useFieldMapper.setAssembleBlocks` / `setDerive`. Clearing a source on a derive edge keeps a derive-only mapping.
- `FieldMapper` `transformOptions` and `renderRowExpansion`. Default transform list still copy / extract / file / lookup; **assemble** is offered on `Html` targets; the current resolve is always listed.
- Sync and async `applyMapping` skip derive/assemble (host apply stays host-owned). Package does not slugify or assemble HTML.
- `resolvedSourceId` only suffixes `extract` / `file`.
- Package `autoMap` is unchanged: it does not inject derive-only slug or default html to assemble.
_Written as mapping 0.7.0._

- Relation lookup is an edge-local stored intent: `FieldMapping.lookup.entries` as `{ value, ref }[]`. `ref` is opaque (`seedLocalId` or `seedUid`). Empty entries are a valid unassigned map.
- `applyMapping` (sync) applies lookup entries and emits refs. Unmatched values are omitted. `applyMappingAsync` reports unmatched on `errors[]` and no longer calls the host `resolve` callback for lookup.
- `autoMap` pairs alias matches such as `author` → List-of-Relation `authors` with `resolve: 'lookup'` and no invented refs.
- `FieldMapper` `renderLookup?: (row: FieldMapperLookupRow) => ReactNode` — host picker on lookup rows (same split as `renderRowAccessory`). Package uid editor is a fallback only.
- `useFieldMapper.setLookupEntries`. Row `sampleValue` and `data-state="needsLookup"` when the current sample has no matching entry.
- `TargetProperty` stays Seed-accurate (`List` + `refValueType: 'Relation'` + `ref`). No `multiple` flag.
- `MappingDocument.lookups` / `lookups` + `onLookupsChange` are deprecated read/write fallbacks for 0.6.0 documents.
- `_pendingResolve` is extract/file only; lookup hits appear in the preview bag.

### Commits

#### Other

- Fix Item proxy descriptors and FieldMapper stale mapping writes. (e26a927f)
- Add derive and assemble as FieldMapper resolve words. (31c5753b)
- Fixing bug so uid doesn't depend on CreatedAttestation (5e64192b)
- Improved field mapping relation handling (76c6b18c)

## 0.6.0 (2026-09-22)

_Written as mapping 0.6.1._

- `FieldMapper` `renderRowAccessory?: (row: FieldMapperRow) => ReactNode` — host chrome slot on each rows-layout row (`.fm-row-accessory` / `classNames.rowAccessory`), after the transform control and before remove. Package does not fetch or preview; hosts return `null` when idle (e.g. show **Preview** only for `resolve: 'extract' | 'file'`).
- Optional `SourceNode.subtitle` for a secondary display line (inspector, wires card, source option labels). Prefer this over stuffing origin into `label`. Display-only — not part of `MappingDocument`.
_Written as mapping 0.6.0._

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

### Commits

#### Features

- add FieldMapper row layout and useFieldMapper hook (32290d70)
- add resolve:lookup for relation value maps (c7a11b64)
- add resolve jobs, URL classifier, and AV media roles (ac9ef29c)
- allow one source to fan out to multiple properties (2f5b4840)

#### Other

- Responding to app developer requests (907b8cdf)
- Field mapper phase 5 work (61e7a518)
- Adding phase 4 work of mapping redesign (e3603ffa)
- Adding cursor rule. More theme work. (9a5b31fc)
- Additional improvements to address developer requests (1e6820ff)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

_Written as mapping 0.5.1._

- Initial Phase 1 release: headless mapping core, markdown + RSS adapters, `FieldMapper` UI.

### Commits

#### Features

- add @seedprotocol/mapping Phase 1 package (d97020cd)
