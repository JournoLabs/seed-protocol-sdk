# Changelog

## Unreleased

- **Breaking (types):** `FieldMapperLookupRow.onSplitChange`, added in 0.7.13, is a required member, so code that builds its own lookup rows must supply it. Rows the package passes to `renderLookup` always have it.
- **Breaking:** the document lookup table is removed: `MappingDocument.lookups`, `MappingLookups`, `lookupRefFromTable`, the `lookups` option of `applyMapping`, `applyMappingAsync` and `resolveLookup`, and `lookups` / `onLookupsChange` on `FieldMapper` and `useFieldMapper`. Lookups read `lookup.entries` on the edge. Without `renderLookup`, the package's uid text editor now always shows on lookup rows; `slots.lookups: false` hides it. It needed `onLookupsChange`.
- `applyResolveToEdge(edge, 'lookup')` keeps `split`, so `useFieldMapper().setTransform(rowId, 'lookup')` on a lookup edge no longer clears it.

## 0.7.13 (2026-10-29)

- **Breaking:** a lookup entry names an ordered list of refs: `LookupEntry` is `{ value, refs: string[] }`, and `ref` is removed from the type. A stored `{ value, ref }` still applies, read as `refs: [ref]`, and `lookupEntriesFromMapping` returns it in the new shape. `lookupRefFromEntries` is replaced by `lookupRefsFromEntries`, which returns the list, and `resolveLookupMapped` by `resolveLookup`, which returns `{ refs, unmatched, split }`. A Relation target given several refs takes the first. The fallback `LookupEditor` takes refs separated by commas or spaces.
- A lookup edge takes `split: { separators }` (`'and'`, `'&'`, `','`; `DEFAULT_LOOKUP_SEPARATORS` is `['and', '&']`). A string with no entry of its own is split and each part is looked up; the known parts' refs apply in the string's order, and each unknown part is reported with `splitFrom`. New `splitLookupValue`, `withLookupSplit`, `useFieldMapper().setLookupSplit` and `FieldMapperLookupRow.onSplitChange`. Moving a lookup to another source, and Auto-map, keep `split`.
- Lookups match case-insensitively: a source value finds an entry with the same new `lookupKey` (NFC, collapsed whitespace, trimmed, case-folded), so a feed that prints "mira chen" once finds the "Mira Chen" entry. `normalizeLookupKey` adds NFC and still keeps case; it's the form entries are stored in. `LookupEditor` shows one row per key.
- `applyMapping` takes `onUnmatched`, called with `{ sourceId, propertyName, value }` for each lookup value that has no entry. Only `applyMappingAsync` reported misses.
- An empty source value on a lookup edge is no lookup: `applyMappingAsync` no longer lists it as an error, and `onUnmatched` isn't called for it.
- `autoMap(sources, targets, previous)` keeps the entries a property that stays a lookup has in `previous`, and `useFieldMapper`'s Auto-map passes its current mappings. One Auto-map click dropped every assignment.
- `withPreservedExtras` keeps a lookup's entries when it moves to another source (`author` to `dc:creator`); they were dropped.
- New `collectLookupValues(items, mapping)`: each distinct value a lookup's source holds across a feed's items, in first-seen spelling.

- An `extract` or `file` edge on a source with an empty value passes `''` as the resolve callback's `url`, and lookups take their sample from the value only (`sampleValueFromSource`, the field mapper's previews and `LookupEditor`). 0.7.12 made `applyMapping` value-only but these still fell back to the source's `label`, so the field's name went to the resolve callback as a URL, and a lookup entry written in the editor for an empty source was stored under the label and never matched at apply.

### Commits

#### Features

- joint bylines: lookup entries name a list of refs, and a lookup edge can split (a024b1a5)

#### Fixes

- case-insensitive lookups, sync unmatched reporting, entries kept through Auto-map and source changes (32e55f77)
- extract/file urls and lookup samples use the source value only (ac651eea)

## 0.7.12 (2026-10-27)

- The published `.d.ts` files resolve under `moduleResolution: node16` and `nodenext`: relative imports carry `.js` (or `/index.js`). Without the extensions, named re-exports were typed `any` and names re-exported with `export *` were missing (TS2305).
- **Breaking:** the `--fm-*` and `--map-*` CSS custom properties are removed; theme with `--sfm-*` (`--sfm-color-*`, `--sfm-map-1` … `--sfm-map-8`). The default theme set each `--fm-*` from its `--sfm-*` token, so a host's own `--fm-*` value was overwritten, and the README's "aliases kept" didn't hold. Wire strokes default to `var(--sfm-map-N, currentColor)`.
- `useFieldMapper` and `FieldMapper` keep a row's id when another row is added, removed or edited. The ids were by position, so removing a row shifted the ids, and React keys, of every row after it.
- `coerceValue(raw, 'Boolean')` reads `true`, `1` and `yes` in any case, trimmed. `"TRUE"` was false.
- `applyMapping` and `applyMappingAsync` copy a source's `value` only: an empty frontmatter field copies as `''` and an empty Markdown body as `''`. They fell back to the source's `label`, so the field's name (or "Full document") was copied.
- `UseFieldMapperResult.conflicts`' doc comment says it holds every row that maps an already-mapped property, the first such row included, as `findConflicts` does.
- The README says `rssXmlToSources` needs `seedVitePlugin({ includeNodePolyfills: true })` in a Vite browser build: `rss-parser` imports Node's `timers`.

### Commits

#### Breaking

- --sfm-* tokens only, stable edge ids, Boolean case, no label fallback (d00c286e)

#### Fixes

- the hook reads row ids from the edge-id state (24e131e1)

## 0.7.11 (2026-10-24)

No user-facing changes; released at the same version as the other packages.

## 0.7.10 (2026-10-24)

No user-facing changes; released at the same version as the other packages.

## 0.7.9 (2026-10-22)

No user-facing changes; released at the same version as the other packages.

## 0.7.8 (2026-10-20)

No user-facing changes; released at the same version as the other packages.

## 0.7.7 (2026-10-18)

### Commits

#### Other

- move internal working docs out of the repo, record their decisions as ADRs (f770a365)

## 0.7.5 (2026-10-17)

### Commits

#### Fixes

- packages: top-level types for legacy resolvers; query main -> Node build (12c51228)

#### Other

- packages: audit feed, feed-hyper, gateway-hyper, mapping, publish, query READMEs (1a5d7ee4)
- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

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

_Derive and assemble. This file used to list them under `0.8.0`, a mapping version that was never published. They first shipped in 0.6.3._

- `ResolveJob` adds `'derive' | 'assemble'`. `FieldMapping.sourceId` is optional so a derive-only edge is legal.
- Persist `derive?: { from: string; fallback?: boolean }` and `assemble?: { blocks: string[] }` on the edge. Mutators pass them through, including copy + `derive` fallback. Empty `sourceId` is omitted.
- Coverage and `data-state` treat source-less `resolve: 'derive'` as mapped. `resolve: 'assemble'` does not flag `needs extract`.
- `useFieldMapper.setAssembleBlocks` / `setDerive`. Clearing a source on a derive edge keeps a derive-only mapping.
- `FieldMapper` `transformOptions` and `renderRowExpansion`. Default transform list still copy / extract / file / lookup; **assemble** is offered on `Html` targets; the current resolve is always listed.
- Sync and async `applyMapping` skip derive/assemble (host apply stays host-owned). Package does not slugify or assemble HTML.
- `resolvedSourceId` only suffixes `extract` / `file`.
- Package `autoMap` is unchanged: it does not inject derive-only slug or default html to assemble.

_Relation lookup, listed in this file under `0.7.0` before the monorepo reached that number. It first shipped in 0.6.1._

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
