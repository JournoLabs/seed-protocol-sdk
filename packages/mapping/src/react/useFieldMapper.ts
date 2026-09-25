import { useCallback, useMemo, useRef, useState } from 'react'
import { autoMap as defaultAutoMap } from '../autoMap'
import {
  applyResolveToEdge,
  clearSourceKeepDerive,
  isDeriveKeepOnClear,
  withPreservedExtras,
} from '../edgeMapping'
import type {
  DeriveSpec,
  FieldMapping,
  LookupEntry,
  ResolveJob,
  TargetProperty,
} from '../types'
import {
  applyAssembleBlocksToMappings,
  applyDeriveToMappings,
  applyLookupEntriesToMappings,
  attachLookupIfNeeded,
  buildPropertyModeRows,
  buildPropertyOptions,
  buildSourceModeRows,
  buildSourceOptions,
  clearLookupsForProperties,
  computeCoverage,
  computeRequiredResolve,
  connectSourceToProperty,
  filterPropertyNames,
  newRowId,
  originSources,
  removeMappingsForSourceId,
  syncEdgeIds,
  type SourceModeDraft,
  upsertPropertyMapping,
} from './fieldMapperCore'
import type {
  UseFieldMapperArgs,
  UseFieldMapperResult,
} from './fieldMapperTypes'

export function useFieldMapper({
  sources,
  targets,
  mappings,
  onChange,
  lookups = {},
  onLookupsChange,
  rowKey = 'property',
  onAutoMap,
}: UseFieldMapperArgs): UseFieldMapperResult {
  const [extraPropertyNames, setExtraPropertyNames] = useState<Set<string>>(
    () => new Set(),
  )
  const [drafts, setDrafts] = useState<SourceModeDraft[]>([])
  const mappingsRef = useRef(mappings)
  const mappingsPropRef = useRef(mappings)
  if (mappingsPropRef.current !== mappings) {
    mappingsPropRef.current = mappings
    mappingsRef.current = mappings
  }
  const edgeIdsRef = useRef<string[]>([])
  edgeIdsRef.current = syncEdgeIds(edgeIdsRef.current, mappingsRef.current.length)
  const edgeIds = edgeIdsRef.current

  const commitMappings = useCallback(
    (next: FieldMapping[]) => {
      mappingsRef.current = next
      edgeIdsRef.current = syncEdgeIds(edgeIdsRef.current, next.length)
      onChange(next)
    },
    [onChange],
  )

  const applyLookupClears = useCallback(
    (props: string[]) => {
      if (!onLookupsChange || props.length === 0) return
      const next = clearLookupsForProperties(lookups, props)
      if (next) onLookupsChange(next)
    },
    [lookups, onLookupsChange],
  )

  const sourceOptions = useMemo(() => buildSourceOptions(sources), [sources])
  const propertyOptions = useMemo(
    () => buildPropertyOptions(targets),
    [targets],
  )

  const coverage = useMemo(
    () => computeCoverage(targets, mappings),
    [targets, mappings],
  )

  const mappedProps = useMemo(
    () => new Set(mappings.map((m) => m.propertyName)),
    [mappings],
  )

  const addableProperties = useMemo(
    () =>
      targets.filter(
        (t) => !mappedProps.has(t.name) && !extraPropertyNames.has(t.name),
      ),
    [targets, mappedProps, extraPropertyNames],
  )

  const propertyRows = useMemo(() => {
    // Property mode always exposes the full target list to the hook;
    // UI filter is applied by the renderer via filterPropertyNames.
    return buildPropertyModeRows({ targets, mappings, sources, lookups })
  }, [targets, mappings, sources, lookups])

  const sourceBuilt = useMemo(() => {
    return buildSourceModeRows({
      mappings,
      edgeIds,
      drafts,
      sources,
      targets,
      lookups,
    })
  }, [mappings, edgeIds, drafts, sources, targets, lookups])

  const rows = rowKey === 'property' ? propertyRows : sourceBuilt.rows
  const conflicts =
    rowKey === 'property' ? new Set<string>() : sourceBuilt.conflicts

  const connect = useCallback(
    (sourceId: string, propertyName: string) => {
      const result = connectSourceToProperty(
        mappingsRef.current,
        sources,
        targets,
        sourceId,
        propertyName,
      )
      commitMappings(result.mappings)
      applyLookupClears(result.clearedLookupProps)
    },
    [sources, targets, commitMappings, applyLookupClears],
  )

  const removeBySource = useCallback(
    (sourceId: string) => {
      const result = removeMappingsForSourceId(mappingsRef.current, sourceId)
      commitMappings(result.mappings)
      applyLookupClears(result.clearedLookupProps)
    },
    [commitMappings, applyLookupClears],
  )

  const autoMap = useCallback(() => {
    const next = onAutoMap ? onAutoMap() : defaultAutoMap(sources, targets)
    commitMappings(next)
    setDrafts([])
    setExtraPropertyNames(new Set())
  }, [onAutoMap, sources, targets, commitMappings])

  const setSource = useCallback(
    (rowId: string, sourceId: string | null) => {
      const current = mappingsRef.current
      if (rowKey === 'property') {
        if (!sourceId) {
          const prev = current.find((m) => m.propertyName === rowId)
          if (prev && isDeriveKeepOnClear(prev)) {
            commitMappings(
              upsertPropertyMapping(current, clearSourceKeepDerive(prev)),
            )
            if (prev.resolve === 'lookup') applyLookupClears([rowId])
            return
          }
          commitMappings(current.filter((m) => m.propertyName !== rowId))
          if (prev?.resolve === 'lookup') applyLookupClears([rowId])
          return
        }
        const result = connectSourceToProperty(
          current,
          sources,
          targets,
          sourceId,
          rowId,
        )
        // Pre-select required transform when connecting a plain origin source
        const target = targets.find((t) => t.name === rowId)
        const source = originSources(sources).find((s) => s.id === sourceId)
        let edge = result.mappings.find((m) => m.propertyName === rowId)!
        if (!edge.resolve) {
          const required = computeRequiredResolve(source, target)
          if (required) {
            edge = { ...edge, resolve: required }
            commitMappings(upsertPropertyMapping(result.mappings, edge))
            applyLookupClears(result.clearedLookupProps)
            return
          }
        }
        commitMappings(result.mappings)
        applyLookupClears(result.clearedLookupProps)
        return
      }

      // source mode
      const edgeIndex = edgeIdsRef.current.indexOf(rowId)
      if (edgeIndex >= 0) {
        if (!sourceId) {
          const prev = current[edgeIndex]
          if (prev && isDeriveKeepOnClear(prev)) {
            const next = [...current]
            next[edgeIndex] = clearSourceKeepDerive(prev)
            commitMappings(next)
            if (prev.resolve === 'lookup') {
              applyLookupClears([prev.propertyName])
            }
            return
          }
          const next = current.filter((_, i) => i !== edgeIndex)
          commitMappings(next)
          if (prev?.resolve === 'lookup') {
            applyLookupClears([prev.propertyName])
          }
          return
        }
        const prev = current[edgeIndex]!
        const target = targets.find((t) => t.name === prev.propertyName)
        let edge: FieldMapping = {
          sourceId,
          propertyName: prev.propertyName,
        }
        edge = attachLookupIfNeeded(edge, target)
        edge = withPreservedExtras(edge, prev)
        if (!edge.resolve) {
          const source = originSources(sources).find((s) => s.id === sourceId)
          const required = computeRequiredResolve(source, target)
          if (required) edge = { ...edge, resolve: required }
        }
        const next = [...current]
        next[edgeIndex] = edge
        commitMappings(next)
        if (prev.resolve === 'lookup' && edge.resolve !== 'lookup') {
          applyLookupClears([prev.propertyName])
        }
        return
      }

      setDrafts((prev) => {
        const updated = prev.map((d) => {
          if (d.id !== rowId) return d
          if (!sourceId) {
            return { id: d.id, propertyName: d.propertyName }
          }
          const target = d.propertyName
            ? targets.find((t) => t.name === d.propertyName)
            : undefined
          const source = originSources(sources).find((s) => s.id === sourceId)
          const required = computeRequiredResolve(source, target)
          const resolve =
            (target &&
              attachLookupIfNeeded(
                { sourceId, propertyName: d.propertyName ?? '' },
                target,
              ).resolve) ||
            required ||
            undefined
          return {
            id: d.id,
            sourceId,
            propertyName: d.propertyName,
            resolve,
          }
        })
        const complete = updated.filter(
          (d) =>
            d.propertyName &&
            (d.sourceId || d.resolve === 'derive'),
        )
        const incomplete = updated.filter(
          (d) =>
            !(
              d.propertyName &&
              (d.sourceId || d.resolve === 'derive')
            ),
        )
        if (complete.length > 0) {
          commitMappings([
            ...mappingsRef.current,
            ...complete.map((d) => ({
              ...(d.sourceId ? { sourceId: d.sourceId } : {}),
              propertyName: d.propertyName!,
              ...(d.resolve ? { resolve: d.resolve } : {}),
            })),
          ])
          return incomplete
        }
        return updated
      })
    },
    [
      rowKey,
      sources,
      targets,
      commitMappings,
      applyLookupClears,
    ],
  )

  const setProperty = useCallback(
    (rowId: string, propertyName: string) => {
      if (rowKey === 'property') {
        // Property mode row ids are property names; renaming is add+remove.
        return
      }

      const current = mappingsRef.current
      const edgeIndex = edgeIdsRef.current.indexOf(rowId)
      if (edgeIndex >= 0) {
        const prev = current[edgeIndex]!
        const target = targets.find((t) => t.name === propertyName)
        const source = originSources(sources).find(
          (s) => s.id === prev.sourceId,
        )
        let edge: FieldMapping = {
          ...(prev.sourceId ? { sourceId: prev.sourceId } : {}),
          propertyName,
        }
        edge = attachLookupIfNeeded(edge, target)
        edge = withPreservedExtras(edge, prev)
        if (!edge.resolve) {
          const required = computeRequiredResolve(source, target)
          if (required) edge = { ...edge, resolve: required }
        }
        const next = [...current]
        next[edgeIndex] = edge
        commitMappings(next)
        if (prev.resolve === 'lookup' && edge.resolve !== 'lookup') {
          applyLookupClears([prev.propertyName])
        }
        if (
          prev.propertyName !== propertyName &&
          prev.resolve === 'lookup' &&
          edge.resolve === 'lookup'
        ) {
          applyLookupClears([prev.propertyName])
        }
        return
      }

      setDrafts((prev) => {
        const updated = prev.map((d) => {
          if (d.id !== rowId) return d
          const target = targets.find((t) => t.name === propertyName)
          const source = d.sourceId
            ? originSources(sources).find((s) => s.id === d.sourceId)
            : undefined
          let resolve = d.resolve
          if (d.sourceId && target) {
            const attached = attachLookupIfNeeded(
              { sourceId: d.sourceId, propertyName },
              target,
            )
            resolve =
              attached.resolve ??
              computeRequiredResolve(source, target) ??
              undefined
          }
          const nextDraft: SourceModeDraft = {
            id: d.id,
            sourceId: d.sourceId,
            propertyName,
            resolve,
          }
          // Promote complete drafts into mappings
          if (nextDraft.sourceId && nextDraft.propertyName) {
            return nextDraft
          }
          return nextDraft
        })

        const complete = updated.filter(
          (d) =>
            d.propertyName &&
            (d.sourceId || d.resolve === 'derive'),
        )
        const incomplete = updated.filter(
          (d) =>
            !(
              d.propertyName &&
              (d.sourceId || d.resolve === 'derive')
            ),
        )

        if (complete.length > 0) {
          const promoted: FieldMapping[] = complete.map((d) => ({
            ...(d.sourceId ? { sourceId: d.sourceId } : {}),
            propertyName: d.propertyName!,
            ...(d.resolve ? { resolve: d.resolve } : {}),
          }))
          commitMappings([...mappingsRef.current, ...promoted])
          return incomplete
        }
        return updated
      })
    },
    [
      rowKey,
      targets,
      sources,
      commitMappings,
      applyLookupClears,
    ],
  )

  const setLookupEntries = useCallback(
    (rowId: string, entries: LookupEntry[]) => {
      const next = applyLookupEntriesToMappings(
        mappingsRef.current,
        rowKey,
        rowId,
        edgeIdsRef.current,
        entries,
      )
      if (!next) return
      commitMappings(next)
      if (!onLookupsChange) return
      const edge =
        rowKey === 'property'
          ? next.find((m) => m.propertyName === rowId)
          : next[edgeIdsRef.current.indexOf(rowId)]
      if (!edge) return
      const table = Object.fromEntries(
        (edge.lookup?.entries ?? []).map((e) => [e.value, e.ref]),
      )
      const merged = { ...lookups }
      if (Object.keys(table).length === 0) {
        delete merged[edge.propertyName]
      } else {
        merged[edge.propertyName] = table
      }
      onLookupsChange(merged)
    },
    [rowKey, commitMappings, onLookupsChange, lookups],
  )

  const setAssembleBlocks = useCallback(
    (rowId: string, blocks: string[]) => {
      const next = applyAssembleBlocksToMappings(
        mappingsRef.current,
        rowKey,
        rowId,
        edgeIdsRef.current,
        blocks,
      )
      if (next) commitMappings(next)
    },
    [rowKey, commitMappings],
  )

  const setDerive = useCallback(
    (rowId: string, spec: DeriveSpec | null) => {
      const next = applyDeriveToMappings(
        mappingsRef.current,
        rowKey,
        rowId,
        edgeIdsRef.current,
        spec,
      )
      if (next) commitMappings(next)
    },
    [rowKey, commitMappings],
  )

  const setTransform = useCallback(
    (rowId: string, resolve: ResolveJob | null) => {
      const current = mappingsRef.current
      if (rowKey === 'property') {
        const prev = current.find((m) => m.propertyName === rowId)
        if (!prev) {
          if (resolve === 'derive') {
            commitMappings(
              upsertPropertyMapping(current, {
                propertyName: rowId,
                resolve: 'derive',
              }),
            )
          }
          return
        }
        commitMappings(upsertPropertyMapping(current, applyResolveToEdge(prev, resolve)))
        if (prev.resolve === 'lookup' && resolve !== 'lookup') {
          applyLookupClears([rowId])
        }
        return
      }

      const edgeIndex = edgeIdsRef.current.indexOf(rowId)
      if (edgeIndex >= 0) {
        const prev = current[edgeIndex]!
        const next = [...current]
        next[edgeIndex] = applyResolveToEdge(prev, resolve)
        commitMappings(next)
        if (prev.resolve === 'lookup' && resolve !== 'lookup') {
          applyLookupClears([prev.propertyName])
        }
        return
      }

      setDrafts((prevDrafts) => {
        const updated = prevDrafts.map((d) =>
          d.id === rowId
            ? { ...d, resolve: resolve ?? undefined }
            : d,
        )
        const complete = updated.filter(
          (d) =>
            d.propertyName &&
            (d.sourceId || d.resolve === 'derive'),
        )
        const incomplete = updated.filter(
          (d) =>
            !(
              d.propertyName &&
              (d.sourceId || d.resolve === 'derive')
            ),
        )
        if (complete.length > 0) {
          commitMappings([
            ...mappingsRef.current,
            ...complete.map((d) => ({
              ...(d.sourceId ? { sourceId: d.sourceId } : {}),
              propertyName: d.propertyName!,
              ...(d.resolve ? { resolve: d.resolve } : {}),
            })),
          ])
          return incomplete
        }
        return updated
      })
    },
    [rowKey, commitMappings, applyLookupClears],
  )

  const addRow = useCallback(
    (propertyName?: string) => {
      if (rowKey === 'property') {
        if (propertyName) {
          setExtraPropertyNames((prev) => new Set(prev).add(propertyName))
        }
        return
      }
      setDrafts((prev) => [
        ...prev,
        {
          id: newRowId('draft'),
          ...(propertyName ? { propertyName } : {}),
        },
      ])
    },
    [rowKey],
  )

  const removeRow = useCallback(
    (rowId: string) => {
      const current = mappingsRef.current
      if (rowKey === 'property') {
        const prev = current.find((m) => m.propertyName === rowId)
        commitMappings(current.filter((m) => m.propertyName !== rowId))
        if (prev?.resolve === 'lookup') applyLookupClears([rowId])
        setExtraPropertyNames((prevSet) => {
          if (!prevSet.has(rowId)) return prevSet
          const next = new Set(prevSet)
          next.delete(rowId)
          return next
        })
        return
      }

      const edgeIndex = edgeIdsRef.current.indexOf(rowId)
      if (edgeIndex >= 0) {
        const prev = current[edgeIndex]
        commitMappings(current.filter((_, i) => i !== edgeIndex))
        if (prev?.resolve === 'lookup') {
          applyLookupClears([prev.propertyName])
        }
        return
      }

      setDrafts((prev) => prev.filter((d) => d.id !== rowId))
    },
    [rowKey, commitMappings, applyLookupClears],
  )

  return {
    rows,
    sourceOptions,
    propertyOptions,
    addableProperties,
    coverage,
    conflicts,
    setSource,
    setProperty,
    setTransform,
    setLookupEntries,
    setAssembleBlocks,
    setDerive,
    addRow,
    removeRow,
    autoMap,
    connect,
    removeBySource,
  }
}

/** Re-export filter helper for row renderers. */
export { filterPropertyNames }
export type { TargetProperty }
