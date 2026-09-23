# FieldMapper redesign — row-based mapping

Design study and implementation spec for the `@seedprotocol/mapping` React UI.
Companion to [MAPPING_PHASE2.md](./MAPPING_PHASE2.md).

**Scope:** Originally UI only. As of `@seedprotocol/mapping@0.7.0`, lookup persist
moved onto the edge (`FieldMapping.lookup.entries`). `MappingDocument.lookups` is
a deprecated read fallback. `applyMapping` / `autoMap` apply stored lookup refs.
The rest of the redesign (rows, theming, extract/file) is unchanged.

## 1. Why the two-pane layout stopped working

`FieldMapper` was designed for markdown → a five-property model: roughly six source
nodes, five targets, four edges. Its cost scales with the number of fields rendered
rather than the number of decisions the user makes, so it degrades as soon as either
side grows.

Measured against a typical WordPress RSS item and a twenty-property Post model:

| | Markdown (original case) | RSS item → Post (today) |
|---|---|---|
| Source cards | 6 | 28 (16 fields + 12 derived) |
| Target cards | 5 | 20 |
| Edges | 4 | 8 |
| Elements to scan to read the map | 15 | 56 |
| Rows in the proposed layout | 4 | 9 |

Four problems are specific to the implementation, not just the paradigm:

1. **Transforms are disguised as source fields.** `buildResolvedSourceNodes` appends
   `@extract` and `@file` nodes per URL-shaped field, so six URL fields inflate 16 real
   fields into 28 cards. `resolve` is already persisted on the *edge*
   (`FieldMapping.resolve`), so the source list is the wrong place to express it.
2. **The color channel runs out.** `FIELD_MAPPER_PAIR_SLOTS` is 8 and strokes cycle on
   `index % 8`, so the ninth edge repeats the first edge's color. Color is the only
   thing separating crossing curves, so disambiguation fails at the scale where it
   starts to matter.
3. **Geometry is polled.** Endpoints come from `getBoundingClientRect` inside a
   `setInterval(update, 200)` that never stops, measured against a container that
   assumes both columns are fully expanded. A host that scrolls either pane
   desynchronises every line, and long lists pay the measurement cost indefinitely.
4. **The interaction is modal and invisible.** Click a source, then click a property.
   The pending state is announced only by a sentence in the toolbar
   (`· click properties (source stays selected)`), there is no escape or undo, and
   clicking an already-mapped property silently replaces its edge.

Secondary: no search, filter, grouping, or required-first ordering; cards are clickable
`div`s with no roles, focus, or keyboard path; the lookup editor is a block at the
bottom of the page, detached from the edge that produced it; the only preview is a
whole-document JSON dump.

## 2. Recommendation

Adopt row-based mapping. Ship **both row orientations** behind a `rowKey` prop —
`'property'` (default) and `'source'` — from one hook, one renderer pair, and one
unchanged persisted edge list.

### `rowKey="property"` — default

Rows are target properties; the source is chosen inside the row.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 5 of 20 properties mapped · 1 required missing        [Auto-map]     │
│ ( Mapped + required )  ( All 20 properties )                         │
├──────────────────────────────────────────────────────────────────────┤
│ title *       from  [ title · "The grid held, barely"    ▾] [copy ▾] ✕│
│ String              The grid held, barely                            │
├──────────────────────────────────────────────────────────────────────┤
│ html *        from  [ content:encoded · "<p>Utilities…"  ▾] [copy ▾] ✕│
│ Html                <p>Utilities leaned on demand…</p>               │
├──────────────────────────────────────────────────────────────────────┤
│ featureImage  from  [ enclosure[0] · "https://cdn…"      ▾] [file ▾] ✕│
│ Image               ‹file stored from cdn.example.org/cover.jpg›     │
├──────────────────────────────────────────────────────────────────────┤
│ slug *        from  [ Choose a source field…            ▾]  String   │
├──────────────────────────────────────────────────────────────────────┤
│ + Add mapping                                                        │
│ ▸ Source fields (16)                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

Row anatomy: property name and dataType on the fixed left edge, a source combobox in
the middle, a transform control that appears once a source is chosen, and a resolved
value preview beneath. Rows never cross, never move, and read as sentences.

Add-mapping flow: "Add mapping" asks which property first, then reveals the source
control — one row for the simple case, growing one row at a time.

**Default visible set.** Mapped rows plus required-but-empty rows, with a filter toggle
for all properties. This keeps a twenty-property model from reintroducing the long-list
problem while still guaranteeing nothing required is silently skipped.

### `rowKey="source"` — the original sketch

Rows are mapping edges in insertion order; the source opens the row and the property is
chosen after it, matching the proposal as written.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 5 of 20 mapped · 1 required missing: slug             [Auto-map]     │
├──────────────────────────────────────────────────────────────────────┤
│ [ title · "The grid held, barely"  ▾] [copy ▾] into [ title      ▾] ✕│
│   The grid held, barely                                              │
├──────────────────────────────────────────────────────────────────────┤
│ [ link · "https://example.org/…"   ▾] [copy ▾] into [ importUrl  ▾] ✕│
│   https://example.org/2026/grid-held                                 │
├──────────────────────────────────────────────────────────────────────┤
│ [ Choose a source field…           ▾]                               ✕│
├──────────────────────────────────────────────────────────────────────┤
│ + Add mapping                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### What each orientation costs

Same hook, same validation, same persisted output. The difference is what the renderer
has to carry:

| Concern | `rowKey="source"` | `rowKey="property"` |
|---|---|---|
| Property exclusivity (one source per property) | Two rows can claim one property; needs conflict detection and an error state | Structurally impossible |
| Required-property coverage | Invisible in the row list; needs its own panel | Visible by construction |
| Fan-out (`link` → `importUrl` + `canonicalUrl`) | Two rows with a duplicated left side; reads like a mistake | Two ordinary rows |
| Row identity | Needs a synthetic row id — a row may hold an empty or duplicate property | The property name is the id |
| Matches comparable tools (§3) | CSV importers | Automation tools |

`'property'` is the default because our job is "fill this record" (§3) and because it
cannot represent an invalid state. `'source'` is a first-class option: it costs one extra
renderer plus two banners, both fed by `conflicts` and `coverage` off the same hook.

### Sources become an inspector, not half the layout

"What is even in this feed?" is a real question the left pane answered. Keep it as a
collapsible section listing field, sample value, and current usage, with a "map this"
action that opens the property picker. Same information, none of the geometry.

## 3. Comparable tools

| Tool | Authoring surface | Row keyed by | Scale handling |
|---|---|---|---|
| Zapier | Action step form | Target field | Per-field `+` opens a searchable source picker; search matches key *and* sample value; nested payloads as collapsible trees with type labels |
| Make | Module config + data tree panel | Target field | Source tree in a separate panel grouped by module; values drop in as tokens |
| n8n | Node parameters + input panel | Target parameter | Input panel with table / JSON / schema views; `resourceMapper` lists destination columns with per-column source selection |
| Flatfile, Plane CSV import | Mapping step | Incoming column | One row per column, searchable target combobox, explicit skip, then a value-level mapping pass |
| HubSpot, Salesforce import | Mapping screen | Incoming column | Name auto-match, per-row override dropdown, required-target checklist before continue |
| DataFlowMapper | Spreadsheet-style editor | Destination field | Searchable source sidebar; mapping config serializes to a readable flat file |

No tool surveyed uses persistent connector lines as its primary authoring surface.

**The split is not arbitrary.** CSV importers key rows by incoming column because the
job is "decide what happens to every column you gave me" — the source set must be
exhausted. Automation tools key rows by target field because the job is "fill this
record" — the source payload is large and mostly irrelevant while the target schema is
finite and has required fields. Ours is the second job: nobody needs a decision about
`contentSnippet`, but an empty `html` breaks the publish run.

Patterns worth borrowing directly:

- **Option labels carry key, sample value, and type** (Zapier). `title · "The grid held…"`
  is what makes a flat combobox usable at 30 options.
- **Search matches keys and values** (Zapier). Users look for the value they saw, not the
  RSS key name.
- **Required-field checklist gates the next step** (HubSpot, Plane).
- **Value-level mapping is its own pass** (Plane). Matches our `resolve: 'lookup'` tables
  exactly — belongs as row expansion, not a page-bottom block.
- **Auto-match, then make every suggestion editable in place** (all of them).

## 4. Proposed API

Additive. Existing props keep working; `layout` defaults to `rows` (Phase 5).
`'wires'` remains supported but deprecated.

```ts
export type FieldMapperLayout = 'rows' | 'wires'

export type FieldMapperSlot =
  | 'root' | 'toolbar' | 'filter' | 'coverage' | 'autoMapButton'
  | 'rowList' | 'row' | 'propertyLabel' | 'dataType' | 'sourceSelect'
  | 'transformSelect' | 'preview' | 'validation' | 'removeButton'
  | 'addButton' | 'inspector' | 'lookupEditor' | 'jsonPreview'

export type FieldMapperProps = {
  // unchanged
  sources: SourceNode[]
  targets: TargetProperty[]
  mappings: FieldMapping[]
  onChange: (mappings: FieldMapping[]) => void
  lookups?: MappingLookups
  onLookupsChange?: (lookups: MappingLookups) => void
  onAutoMap?: () => FieldMapping[]
  className?: string

  layout?: FieldMapperLayout
  /**
   * Which side opens each row. `'property'` (default) cannot represent an
   * invalid state; `'source'` matches the edge list and needs the conflict
   * banner and coverage panel. Ignored when `layout === 'wires'`.
   */
  rowKey?: 'property' | 'source'
  /** `default` paint + layout · `structural` layout only · `none` neither. */
  theme?: 'default' | 'structural' | 'none'
  /** Per-slot class injection; merged with package classes, never replacing them. */
  classNames?: Partial<Record<FieldMapperSlot, string>>
  /** Host design-system controls. Defaults are dependency-free natives. */
  components?: {
    Select?: React.ComponentType<FieldMapperSelectProps>
    Button?: React.ComponentType<FieldMapperButtonProps>
    Pill?: React.ComponentType<{ children: React.ReactNode }>
  }
  /** Include / exclude structural pieces. Replaces `showPreview`. */
  slots?: {
    autoMap?: boolean
    filter?: boolean
    inspector?: boolean
    preview?: 'row' | 'json' | 'both' | false
    lookups?: 'row' | 'section' | false
  }
  /** Rows shown before the filter is widened. Default `'requiredAndMapped'`. */
  defaultRows?: 'requiredAndMapped' | 'mapped' | 'all'
}
```

Deprecate `connectionColors`, `showPreview`, and `theme="unstyled"` with shims (map
`unstyled` → `none`, `showPreview: false` → `slots.preview: false`).

### Headless hook

The real answer to "SDK users will style this themselves": put the mechanics in a hook
and make the default component a thin skin over it.

```ts
export function useFieldMapper(args: {
  sources: SourceNode[]
  targets: TargetProperty[]
  mappings: FieldMapping[]
  onChange: (mappings: FieldMapping[]) => void
  lookups?: MappingLookups
  rowKey?: 'property' | 'source'
}): {
  /** Target properties when `rowKey: 'property'`, edges when `rowKey: 'source'`. */
  rows: FieldMapperRow[]
  sourceOptions: FieldMapperOption[]
  propertyOptions: FieldMapperOption[]
  addableProperties: TargetProperty[]
  coverage: { mapped: number; total: number; missingRequired: string[] }
  /** Row ids whose property is already filled by an earlier row. Empty in property mode. */
  conflicts: Set<string>
  setSource: (rowId: string, sourceId: string | null) => void
  setProperty: (rowId: string, propertyName: string) => void
  setTransform: (rowId: string, resolve: ResolveJob | null) => void
  addRow: (propertyName?: string) => void
  removeRow: (rowId: string) => void
  autoMap: () => void
}

export type FieldMapperRow = {
  /** Property name in property mode; a synthetic edge id in source mode. */
  id: string
  target?: TargetProperty
  mapping?: FieldMapping
  source?: SourceNode
  /** Sync preview, or a description of what the host resolver will produce. */
  preview: string
  /** Transform this edge needs to yield a usable value, if any. */
  requiredResolve: ResolveJob | null
  state: 'empty' | 'mapped' | 'needsResolve' | 'conflict'
}
```

A synthetic row id is needed in source mode because a row may legitimately hold an empty
or duplicate property while the user is mid-edit. Ids are UI-only — `FieldMapping` is
unchanged, and edges serialize in row order.

This also makes the mechanics unit-testable without a DOM — today only
`connectionStrokeForIndex` has coverage, because everything else is entangled with
layout measurement.

### Validation rules

Derived from the constraints `autoMap` and `applyMapping` already encode, surfaced
per row instead of silently skipped at apply time:

| Source shape | Target | Required transform |
|---|---|---|
| any text | `Relation` / `List<Relation>` | `lookup` |
| URL | `Image`, `File` | `file` |
| URL | `Html` | `extract` |
| anything else | anything else | none (`copy`) |

Pick a source and the row pre-selects the required transform; override it and the row
shows a `needs extract` style flag. Nothing is silently dropped.

## 5. Theming contract

Five layers, cheapest first. Layers 1–3 are CSS-only and need no prop plumbing.

| Layer | Mechanism | Buys the host |
|---|---|---|
| 1 | `--sfm-*` custom properties | Color, spacing, radius, control height, font family from one place |
| 2 | `classNames` per slot | Per-element classes merged with package classes |
| 3 | `data-*` state attributes | Styling by live state from host CSS |
| 4 | `components` | Host's own combobox / button / pill |
| 5 | `useFieldMapper` | Fully bespoke markup |

**Tokens.** Extend past color, which is all `--fm-*` covers today:

```
--sfm-color-{ground,ink,well,line,muted,faint,selection,warning,danger}
--sfm-space-{1,2,3,4}          --sfm-radius-{sm,md,lg}
--sfm-font-{family,mono,size-{sm,md}}
--sfm-control-height           --sfm-row-gap
```

Keep `--fm-*` as aliases for one minor. **`--sfm-font-family` defaults to `inherit`** —
the current hardcoded `'DM Sans'` / `'JetBrains Mono'` stacks are the single most common
thing a host has to fight.

**State attributes.** `data-state="empty|mapped|needsResolve"`, `data-required`,
`data-resolve="extract|file|lookup"`, `data-source-kind`, `data-property-name`. These
replace `data-pair` and `data-mapping-index`, which existed only to color wires.

**Cascade.** Emit the default skin inside `@layer seed-field-mapper` so host rules win
without specificity fights, and inject it once per document rather than re-rendering a
`<style>` element inside every mounted instance as the current component does.

## 6. Rollout

Each phase is independently shippable; the persisted format never changes.

| Phase | Work | Verification |
|---|---|---|
| 1 | Extract `useFieldMapper` from `FieldMapper`; keep the wire layout rendering from it | New hook unit tests; existing tests green — **shipped** |
| 2a | Add `layout="rows"` with `rowKey="property"`: row list, transform control, coverage, filter, add-flow, inspector | Row mechanics unit tests; markdown and RSS smoke — **shipped** |
| 2b | Add `rowKey="source"` renderer over the same hook, plus conflict banner and coverage panel | Conflict and coverage unit tests; both modes produce identical `MappingDocument` output for the same edges — **shipped** |
| 3 | Theming contract: `--sfm-*` tokens, `classNames`, `data-*`, `components`, `slots`, `@layer`, deprecation shims | Token/slot tests alongside `fieldMapperTheme.test.ts` — **shipped** |
| 4 | Per-row preview and per-row lookup editor; JSON behind a disclosure | Preview parity with `applyMapping` output — **shipped** |
| 5 | Flip `layout` default to `rows`, deprecate `wires`; consumer handoff | Package default + docs; PermaPress Feed Map already on rows — **shipped** (desktop `/import/map` migration still deferred) |

**PermaPress** adopted property-keyed rows (`layout="rows"`, `theme="none"`) during the redesign; see [FIELD_MAPPER_PERMAPRESS_HANDOFF.md](./FIELD_MAPPER_PERMAPRESS_HANDOFF.md). **seed-protocol-desktop** still runs a local `MarkdownMapper.tsx` — migrate once onto the shared rows UI when that app is in scope.

Retire `buildResolvedSourceNodes` from the *UI* path in phase 2a but keep exporting it:
`autoMap` and existing host code depend on it, and `parseResolvedSourceId` /
`normalizeMappingFromSourceId` still normalize edges persisted by the current UI.

## 7. Open questions

- **Does a consumer actually want `rowKey="source"`?** Phase 2b is cheap but not free,
  and nothing forces it to ship with 2a. Worth asking desktop and PermaPress before
  building it; if neither wants it, it becomes a documented hook capability rather than a
  second renderer.
- **Keep a read-only wire view?** Pleasant for small maps and shareable as an overview,
  but it is the piece we can most afford to lose. Recommend cutting it and revisiting
  only if a consumer asks.
- **Combobox implementation.** A native `<select>` is free, accessible, and works on
  mobile, but cannot render two-line options or match on sample values. A custom
  listbox gets both at the cost of ~150 lines of ARIA. Recommend native first, with
  layer 4 as the escape hatch, and revisit once a source list exceeds ~40 options.
- **Multi-source targets.** Nothing today concatenates two sources into one property
  (`creator` + `dc:creator`, or a title template). Rows make this expressible later as
  a per-row expansion; out of scope here.
- **Saved maps.** Still host-owned per MAPPING_PHASE2 §3. Row layout makes a saved-map
  diff view cheap if we want one.
