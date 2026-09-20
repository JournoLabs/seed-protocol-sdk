import { looksLikeUrl } from '../classifyUrl'
import { isRelationLookupTarget } from '../relationLookup'
import {
  normalizeMappingFromSourceId,
  parseResolvedSourceId,
} from '../resolvedSources'
import type {
  FieldMapping,
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
  const sample = truncateSample(source.value, 36)
  if (!sample) return source.label
  return `${source.label} · "${sample}"`
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

export function previewForEdge(
  source: SourceNode | undefined,
  resolve: ResolveJob | undefined,
): string {
  if (!source) return ''
  if (resolve === 'extract') {
    return `‹extract HTML from ${truncateSample(source.value, 48)}›`
  }
  if (resolve === 'file') {
    return `‹file stored from ${truncateSample(source.value, 48)}›`
  }
  if (resolve === 'lookup') {
    return `‹lookup uid for "${truncateSample(source.value, 48)}"›`
  }
  return truncateSample(source.value, 80)
}

export function rowState(args: {
  mapping?: FieldMapping
  requiredResolve: ResolveJob | null
  conflict?: boolean
}): FieldMapperRowState {
  if (args.conflict) return 'conflict'
  if (!args.mapping?.sourceId || !args.mapping.propertyName) return 'empty'
  const actual = args.mapping.resolve ?? null
  if (args.requiredResolve && actual !== args.requiredResolve) {
    return 'needsResolve'
  }
  return 'mapped'
}

export function computeCoverage(
  targets: TargetProperty[],
  mappings: FieldMapping[],
): FieldMapperCoverage {
  const mappedProps = new Set(
    mappings.filter((m) => m.sourceId && m.propertyName).map((m) => m.propertyName),
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
  if (edge.resolve) return edge
  if (target && isRelationLookupTarget(target)) {
    return { ...edge, resolve: 'lookup' }
  }
  return edge
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
  if (!sources.some((s) => s.id === edge.sourceId)) {
    const origin = originSources(sources).find((s) => s.id === edge.sourceId)
    if (!origin && sources.some((s) => s.id === sourceId)) {
      // keep normalized edge as-is
    }
  }

  const prev = mappings.find((m) => m.propertyName === propertyName)
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
        c.sourceId === parsed.originId && c.resolve === parsed.resolve
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
  /** When set, only these property names appear (add-flow extras). */
  visiblePropertyNames?: Set<string> | null
}): FieldMapperRow[] {
  const { targets, mappings, sources } = args
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
    const source = mapping
      ? sourceById.get(mapping.sourceId)
      : undefined
    const requiredResolve = computeRequiredResolve(source, target)
    const state = rowState({ mapping, requiredResolve })
    return {
      id: target.name,
      target,
      mapping,
      source,
      preview: previewForEdge(source, mapping?.resolve),
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
}): { rows: FieldMapperRow[]; conflicts: Set<string> } {
  const { mappings, edgeIds, drafts, sources, targets } = args
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
      source: sourceById.get(mapping.sourceId),
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
      r.mapping && r.mapping.sourceId && r.mapping.propertyName
        ? r.mapping
        : r.mapping
    const state = rowState({
      mapping:
        mapping && mapping.sourceId && mapping.propertyName
          ? mapping
          : undefined,
      requiredResolve,
      conflict: conflicts.has(r.id),
    })
    // Drafts with only source or only property stay empty
    const effectiveState =
      !mapping?.sourceId || !mapping?.propertyName
        ? conflicts.has(r.id)
          ? 'conflict'
          : 'empty'
        : state

    return {
      id: r.id,
      target: r.target,
      mapping:
        mapping && mapping.sourceId && mapping.propertyName
          ? mapping
          : undefined,
      source: r.source,
      preview: previewForEdge(
        r.source,
        mapping && mapping.sourceId && mapping.propertyName
          ? mapping.resolve
          : undefined,
      ),
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
