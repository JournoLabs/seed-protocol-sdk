# 0017. `@seedprotocol/mapping`: a headless core, a props-driven UI, and edges as the saved format

- **Status:** Accepted
- **Date:** 2026-10-18 (records decisions shipped in 0.6.0 and after)
- **Scope:** `@seedprotocol/mapping`, `@seedprotocol/mapping/react`

## Context

Apps import content (markdown files, RSS items) into Seed models and need to map source fields to
model properties, save that map, and apply it later in a pipeline. PermaPress and the desktop app
each had their own mapper. The first shared `FieldMapper` drew two columns of cards joined by
colored wires. It was built for about six sources and five properties; on an RSS item against a
twenty-property Post it showed 56 elements to read nine decisions, ran out of wire colors after
eight edges, polled geometry every 200 ms, and modeled transforms (`@extract`, `@file`) as extra
source cards.

## Decision

**Package boundaries.** The headless core (`SourceNode`, `FieldMapping`, `MappingDocument`,
`applyMapping`, `autoMap`, and the markdown and RSS adapters) is the default entry. The React UI
is `@seedprotocol/mapping/react`. The package has no `@seedprotocol/*` dependencies; the UI is
driven by props only, with no item creation hooks and no router. Saving maps and creating items
belong to the host app.

**Two separate contracts.** `FieldMapping` maps a source to a property. `FeedFieldManifest`, in
the feed package, maps a property to a feed role. Neither absorbs the other.

**Edges are the saved format.** A `MappingDocument` is a list of edges. Transforms live on the
edge (`resolve`, `lookup.entries`), not as synthetic sources. Layout changes never change the saved
format.

**Rows by default.** `layout` defaults to `rows` with `rowKey="property"`: one row per target
property, the source chosen inside the row. `rowKey="source"` renders the same hook and edges the
other way. `wires` is deprecated. `useFieldMapper` exposes the logic for fully custom markup.

**Theming** follows ADR 0002: `--sfm-*` tokens (with `--fm-*` aliases for a minor),
`--sfm-font-family` defaulting to `inherit`, `classNames` per slot, `data-*` state attributes,
replaceable `components`, and a default stylesheet injected once per document inside
`@layer seed-field-mapper`.

## Consequences

Hosts can restyle or replace the UI without forking, and maps saved by older versions keep
loading. `buildResolvedSourceNodes` stays exported because `autoMap` and edges saved by the wire
UI depend on it. The desktop app still runs its own mapper. Multi-source targets (concatenating
two sources into one property) aren't expressible yet.

## Alternatives considered

- **Keep the two-pane wire layout and fix its bugs.** Its cost grows with the number of fields
  shown rather than decisions made, so it degrades at the sizes real feeds have.
- **Depend on the SDK and create items from the UI.** Ties the package to one app flow and to SDK
  versions; hosts already own creation and routing.
