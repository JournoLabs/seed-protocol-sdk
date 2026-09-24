import { applyMapping, coerceValue } from '../applyMapping'
import { looksLikeUrl } from '../classifyUrl'
import {
  isPresentEdge,
  withAssembleBlocks,
  withDeriveSpec,
  withPreservedExtras,
} from '../edgeMapping'
import {
  isRelationLookupTarget,
  resolveLookupMapped,
  sampleValueFromSource,
  shapeLookupValue,
  stripLookup,
  withLookupEntries,
} from '../relationLookup'
import {
  normalizeMappingFromSourceId,
  parseResolvedSourceId,
} from '../resolvedSources'
import type {
  DeriveSpec,
  FieldMapping,
  LookupEntry,
  MappingLookups,
  ResolveJob,
  SourceNode,
  TargetProperty,
} from '../types'
import type {
  FieldMapperCoverage,
  FieldMapperOption,
  FieldMapperRow,
  FieldMapperRowState,
} from './fieldMapperTypes'

export function truncateSample(s: string, n = 40): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n)}…`
}

export function formatSourceOptionLabel(source: SourceNode): string {
  const head = source.subtitle
    ? `${source.label} · ${source.subtitle}`
    : source.label
  const sample = truncateSample(source.value, 36)
  if (!sample) return head
  return `${head} · "${sample}"`
}

/** Origin sources only — rows UI does not list `@extract`/`@file` cards. */
export function originSources(sources: SourceNode[]): SourceNode[] {
  return sources.filter((s) => s.kind !== 'resolved')
}

export function buildSourceOptions(sources: SourceNode[]): FieldMapperOption[] {
  return originSources(sources).map((s) => ({
    value: s.id,
    label: formatSourceOptionLabel(s),
    sample: s.value,
    kind: s.kind,
  }))
}

export function buildPropertyOptions(
  targets: TargetProperty[],
): FieldMapperOption[] {
  return targets.map((t) => ({
    value: t.name,
    label: t.required ? `${t.name} *` : t.name,
    dataType: t.dataType,
  }))
}

function sourceLooksLikeUrl(source: SourceNode): boolean {
  if (source.kind === 'full' || source.kind === 'section') return false
  const url =
    typeof source.meta?.url === 'string' && source.meta.url.trim()
      ? source.meta.url.trim()
      : source.value
  if (url.trim().includes('<')) return false
  return looksLikeUrl(url)
}

/**
 * Transform required for a usable apply — mirrors autoMap / applyMapping rules.
 */
export function computeRequiredResolve(
  source: SourceNode | undefined,
  target: TargetProperty | undefined,
): ResolveJob | null {
  if (!source || !target) return null
  if (isRelationLookupTarget(target)) return 'lookup'
  if (sourceLooksLikeUrl(source)) {
    if (target.dataType === 'Image' || target.dataType === 'File') return 'file'
    if (target.dataType === 'Html') return 'extract'
  }
  return null
}

export type PreviewForEdgeOptions = {
  target?: TargetProperty
  lookups?: MappingLookups
  propertyName?: string
  mapping?: FieldMapping
}

/**
 * Sync row preview aligned with `applyMapping` / lookup tables.
 * `extract`/`file` stay descriptive (sync apply skips them).
 * `lookup` shows a stored-entry hit when present; otherwise a pending placeholder.
 * Plain copy shows the coerced value when a target is known.
 */
export function previewForEdge(
  source: SourceNode | undefined,
  resolve: ResolveJob | undefined,
  options?: PreviewForEdgeOptions,
): string {
  if (resolve === 'derive') {
    const from = options?.mapping?.derive?.from
    return from ? `‹derive from ${from}›` : '‹derive›'
  }
  if (resolve === 'assemble') {
    const blocks = options?.mapping?.assemble?.blocks
    if (blocks?.length) return `‹assemble ${blocks.join(', ')}›`
    return '‹assemble›'
  }
  if (!source) return ''
  if (resolve === 'extract') {
    return `‹extract HTML from ${truncateSample(source.value, 48)}›`
  }
  if (resolve === 'file') {
    return `‹file stored from ${truncateSample(source.value, 48)}›`
  }
  if (resolve === 'lookup') {
    const raw = source.value || source.label
    const mapping = options?.mapping ?? {
      sourceId: source.id,
      propertyName: options?.propertyName ?? options?.target?.name ?? '',
      resolve: 'lookup' as const,
    }
    const mapped = resolveLookupMapped(mapping, raw, options?.lookups)
    if (mapped !== undefined) {
      const shaped = options?.target
        ? shapeLookupValue(mapped, options.target)
        : mapped
      if (Array.isArray(shaped)) {
        return truncateSample(shaped.join(', '), 80)
      }
      return truncateSample(String(shaped), 80)
    }
    return `‹lookup ref for "${truncateSample(source.value, 48)}"›`
  }
  // Sync apply skips plain copies onto relation targets.
  if (options?.target && isRelationLookupTarget(options.target)) {
    return ''
  }
  if (options?.target) {
    const raw = source.value || source.label
    const coerced = coerceValue(raw, options.target.dataType)
    if (typeof coerced === 'string') return truncateSample(coerced, 80)
    if (typeof coerced === 'number' || typeof coerced === 'boolean') {
      return String(coerced)
    }
    try {
      return truncateSample(JSON.stringify(coerced), 80)
    } catch {
      return truncateSample(String(coerced), 80)
    }
  }
  return truncateSample(source.value, 80)
}

/**
 * JSON preview bag: sync `applyMapping` output plus `_pendingResolve` for
 * edges that require a host resolver (matches wires layout).
 */
export function buildSyncPreviewBag(
  sources: SourceNode[],
  mappings: FieldMapping[],
  targets: TargetProperty[],
): Record<string, unknown> {
  const bag = applyMapping(sources, mappings, targets) as Record<
    string,
    unknown
  >
  const pendingResolve = mappings.filter(
    (m) => m.resolve && m.resolve !== 'lookup',
  )
  if (pendingResolve.length === 0) return bag
  return {
    ...bag,
    _pendingResolve: pendingResolve.map((m) => ({
      propertyName: m.propertyName,
      sourceId: m.sourceId,
      resolve: m.resolve,
    })),
  }
}

export function rowState(args: {
  mapping?: FieldMapping
  requiredResolve: ResolveJob | null
  conflict?: boolean
  sampleValue?: string
  lookups?: MappingLookups
}): FieldMapperRowState {
  if (args.conflict) return 'conflict'
  if (!args.mapping || !isPresentEdge(args.mapping)) return 'empty'
  const actual = args.mapping.resolve ?? null
  if (args.requiredResolve && actual !== args.requiredResolve) {
    if (!(actual === 'assemble' && args.requiredResolve === 'extract')) {
      return 'needsResolve'
    }
  }
  if (actual === 'lookup') {
    const sample = args.sampleValue ?? ''
    if (
      !sample ||
      resolveLookupMapped(args.mapping, sample, args.lookups) === undefined
    ) {
      return 'needsLookup'
    }
  }
  return 'mapped'
}


export function computeCoverage(
  targets: TargetProperty[],
  mappings: FieldMapping[],
): FieldMapperCoverage {
  const mappedProps = new Set(
    mappings.filter(isPresentEdge).map((m) => m.propertyName),
  )
  const missingRequired = targets
    .filter((t) => t.required && !mappedProps.has(t.name))
    .map((t) => t.name)
  return {
    mapped: mappedProps.size,
    total: targets.length,
    missingRequired,
  }
}

export function findConflicts(rows: { id: string; propertyName?: string }[]): Set<string> {
  const seen = new Map<string, string>()
  const conflicts = new Set<string>()
  for (const row of rows) {
    const prop = row.propertyName
    if (!prop) continue
    const first = seen.get(prop)
    if (first) {
      conflicts.add(row.id)
      conflicts.add(first)
    } else {
      seen.set(prop, row.id)
    }
  }
  return conflicts
}

export function attachLookupIfNeeded(
  edge: FieldMapping,
  target: TargetProperty | undefined,
): FieldMapping {
  if (edge.resolve) {
    return edge.resolve === 'lookup' ? edge : stripLookup(edge)
  }
  if (target && isRelationLookupTarget(target)) {
    return { ...stripLookup(edge), resolve: 'lookup' }
  }
  return stripLookup(edge)
}

export function applyAssembleBlocksToMappings(
  mappings: FieldMapping[],
  rowKey: 'property' | 'source',
  rowId: string,
  edgeIds: string[],
  blocks: string[],
): FieldMapping[] | null {
  const index =
    rowKey === 'property'
      ? mappings.findIndex((m) => m.propertyName === rowId)
      : edgeIds.indexOf(rowId)
  if (index < 0) return null
  const prev = mappings[index]
  if (!prev || prev.resolve !== 'assemble') return null
  const next = [...mappings]
  next[index] = withAssembleBlocks(prev, blocks)
  return next
}

export function applyDeriveToMappings(
  mappings: FieldMapping[],
  rowKey: 'property' | 'source',
  rowId: string,
  edgeIds: string[],
  spec: DeriveSpec | null,
): FieldMapping[] | null {
  if (rowKey === 'property') {
    const index = mappings.findIndex((m) => m.propertyName === rowId)
    if (index >= 0) {
      const next = [...mappings]
      next[index] = withDeriveSpec(mappings[index]!, spec)
      return next
    }
    if (!spec) return null
    return upsertPropertyMapping(mappings, {
      propertyName: rowId,
      resolve: 'derive',
      derive: spec,
    })
  }
  const edgeIndex = edgeIds.indexOf(rowId)
  if (edgeIndex < 0) return null
  const prev = mappings[edgeIndex]
  if (!prev) return null
  const next = [...mappings]
  next[edgeIndex] = withDeriveSpec(prev, spec)
  return next
}

export function applyLookupEntriesToMappings(
  mappings: FieldMapping[],
  rowKey: 'property' | 'source',
  rowId: string,
  edgeIds: string[],
  entries: LookupEntry[],
): FieldMapping[] | null {
  if (rowKey === 'property') {
    const index = mappings.findIndex((m) => m.propertyName === rowId)
    if (index < 0) return null
    const prev = mappings[index]!
    if (prev.resolve !== 'lookup') return null
    const next = [...mappings]
    next[index] = withLookupEntries(prev, entries)
    return next
  }
  const edgeIndex = edgeIds.indexOf(rowId)
  if (edgeIndex < 0) return null
  const prev = mappings[edgeIndex]
  if (!prev || prev.resolve !== 'lookup') return null
  const next = [...mappings]
  next[edgeIndex] = withLookupEntries(prev, entries)
  return next
}

export function upsertPropertyMapping(
  mappings: FieldMapping[],
  edge: FieldMapping,
): FieldMapping[] {
  const next = mappings.filter((m) => m.propertyName !== edge.propertyName)
  next.push(edge)
  return next
}

export function clearLookupsForProperties(
  lookups: MappingLookups,
  propertyNames: string[],
): MappingLookups | null {
  if (propertyNames.length === 0) return null
  let changed = false
  const next = { ...lookups }
  for (const name of propertyNames) {
    if (name in next) {
      delete next[name]
      changed = true
    }
  }
  return changed ? next : null
}

export function connectSourceToProperty(
  mappings: FieldMapping[],
  sources: SourceNode[],
  targets: TargetProperty[],
  sourceId: string,
  propertyName: string,
): { mappings: FieldMapping[]; clearedLookupProps: string[] } {
  const targetsByName = new Map(targets.map((t) => [t.name, t]))
  let edge = normalizeMappingFromSourceId(sourceId, propertyName)
  edge = attachLookupIfNeeded(edge, targetsByName.get(propertyName))

  // Prefer origin source id even when host passed only resolved nodes
  if (edge.sourceId && !sources.some((s) => s.id === edge.sourceId)) {
    const origin = originSources(sources).find((s) => s.id === edge.sourceId)
    if (!origin && sources.some((s) => s.id === sourceId)) {
      // keep normalized edge as-is
    }
  }

  const prev = mappings.find((m) => m.propertyName === propertyName)
  edge = withPreservedExtras(edge, prev)
  const next = upsertPropertyMapping(mappings, edge)
  const clearedLookupProps: string[] = []
  if (prev?.resolve === 'lookup' && edge.resolve !== 'lookup') {
    clearedLookupProps.push(propertyName)
  }
  return { mappings: next, clearedLookupProps }
}

export function removeMappingsForSourceId(
  mappings: FieldMapping[],
  sourceId: string,
): { mappings: FieldMapping[]; clearedLookupProps: string[] } {
  const parsed = parseResolvedSourceId(sourceId)
  const clearedLookupProps: string[] = []
  const next = mappings.filter((c) => {
    let keep: boolean
    if (parsed) {
      keep = !(
        Boolean(c.sourceId) &&
        c.sourceId === parsed.originId &&
        c.resolve === parsed.resolve
      )
    } else {
      keep = c.sourceId !== sourceId
    }
    if (!keep && c.resolve === 'lookup') {
      clearedLookupProps.push(c.propertyName)
    }
    return keep
  })
  return { mappings: next, clearedLookupProps }
}

export function buildPropertyModeRows(args: {
  targets: TargetProperty[]
  mappings: FieldMapping[]
  sources: SourceNode[]
  lookups?: MappingLookups
  /** When set, only these property names appear (add-flow extras). */
  visiblePropertyNames?: Set<string> | null
}): FieldMapperRow[] {
  const { targets, mappings, sources, lookups } = args
  const byName = new Map(mappings.map((m) => [m.propertyName, m]))
  const sourceById = new Map(originSources(sources).map((s) => [s.id, s]))
  // Also index all sources for resolve edges that still point at origin
  for (const s of sources) {
    if (!sourceById.has(s.id)) sourceById.set(s.id, s)
  }

  const list =
    args.visiblePropertyNames == null
      ? targets
      : targets.filter((t) => args.visiblePropertyNames!.has(t.name))

  return list.map((target) => {
    const mapping = byName.get(target.name)
    const source = mapping?.sourceId
      ? sourceById.get(mapping.sourceId)
      : undefined
    const requiredResolve = computeRequiredResolve(source, target)
    const sampleValue = sampleValueFromSource(source)
    const state = rowState({ mapping, requiredResolve, sampleValue, lookups })
    return {
      id: target.name,
      target,
      mapping,
      source,
      sampleValue,
      preview: previewForEdge(source, mapping?.resolve, {
        target,
        lookups,
        propertyName: target.name,
        mapping,
      }),
      requiredResolve,
      state,
    }
  })
}

export type SourceModeDraft = {
  id: string
  sourceId?: string
  propertyName?: string
  resolve?: ResolveJob
}

export function buildSourceModeRows(args: {
  mappings: FieldMapping[]
  edgeIds: string[]
  drafts: SourceModeDraft[]
  sources: SourceNode[]
  targets: TargetProperty[]
  lookups?: MappingLookups
}): { rows: FieldMapperRow[]; conflicts: Set<string> } {
  const { mappings, edgeIds, drafts, sources, targets, lookups } = args
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const targetsByName = new Map(targets.map((t) => [t.name, t]))

  const edgeRows: {
    id: string
    propertyName?: string
    mapping?: FieldMapping
    source?: SourceNode
    target?: TargetProperty
  }[] = []

  for (let i = 0; i < mappings.length; i++) {
    const mapping = mappings[i]!
    const id = edgeIds[i] ?? `edge-${i}`
    edgeRows.push({
      id,
      propertyName: mapping.propertyName,
      mapping,
      source: mapping.sourceId ? sourceById.get(mapping.sourceId) : undefined,
      target: targetsByName.get(mapping.propertyName),
    })
  }

  for (const draft of drafts) {
    edgeRows.push({
      id: draft.id,
      propertyName: draft.propertyName,
      mapping:
        draft.sourceId && draft.propertyName
          ? {
              sourceId: draft.sourceId,
              propertyName: draft.propertyName,
              ...(draft.resolve ? { resolve: draft.resolve } : {}),
            }
          : draft.sourceId || draft.propertyName
            ? {
                sourceId: draft.sourceId ?? '',
                propertyName: draft.propertyName ?? '',
                ...(draft.resolve ? { resolve: draft.resolve } : {}),
              }
            : undefined,
      source: draft.sourceId ? sourceById.get(draft.sourceId) : undefined,
      target: draft.propertyName
        ? targetsByName.get(draft.propertyName)
        : undefined,
    })
  }

  const conflicts = findConflicts(edgeRows)

  const rows: FieldMapperRow[] = edgeRows.map((r) => {
    const requiredResolve = computeRequiredResolve(r.source, r.target)
    const mapping =
      r.mapping && r.mapping.propertyName
        ? r.mapping
        : r.mapping
    const sampleValue = sampleValueFromSource(r.source)
    const complete =
      mapping && isPresentEdge(mapping) ? mapping : undefined
    const state = rowState({
      mapping: complete,
      requiredResolve,
      conflict: conflicts.has(r.id),
      sampleValue,
      lookups,
    })
    // Drafts with only source or only property stay empty
    const effectiveState =
      !complete
        ? conflicts.has(r.id)
          ? 'conflict'
          : 'empty'
        : state

    return {
      id: r.id,
      target: r.target,
      mapping: complete,
      source: r.source,
      sampleValue,
      preview: previewForEdge(r.source, complete?.resolve, {
        target: r.target,
        lookups,
        propertyName: complete?.propertyName,
        mapping: complete,
      }),
      requiredResolve,
      state: effectiveState,
    }
  })

  return { rows, conflicts }
}

export function newRowId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function syncEdgeIds(
  prev: string[],
  mappingCount: number,
): string[] {
  if (prev.length === mappingCount) return prev
  if (prev.length > mappingCount) return prev.slice(0, mappingCount)
  const next = [...prev]
  while (next.length < mappingCount) {
    next.push(newRowId('edge'))
  }
  return next
}

export function filterPropertyNames(
  targets: TargetProperty[],
  mappings: FieldMapping[],
  mode: 'requiredAndMapped' | 'mapped' | 'all',
  extra: Set<string>,
): Set<string> | null {
  if (mode === 'all') return null
  const mapped = new Set(mappings.map((m) => m.propertyName))
  const names = new Set<string>(extra)
  for (const t of targets) {
    if (mapped.has(t.name)) names.add(t.name)
    else if (mode === 'requiredAndMapped' && t.required) names.add(t.name)
  }
  return names
}
