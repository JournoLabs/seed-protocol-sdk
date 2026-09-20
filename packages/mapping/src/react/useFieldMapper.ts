import { useCallback, useMemo, useRef, useState } from 'react'
import { autoMap as defaultAutoMap } from '../autoMap'
import type { FieldMapping, ResolveJob, TargetProperty } from '../types'
import {
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
  const edgeIdsRef = useRef<string[]>([])
  edgeIdsRef.current = syncEdgeIds(edgeIdsRef.current, mappings.length)
  const edgeIds = edgeIdsRef.current

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
        mappings,
        sources,
        targets,
        sourceId,
        propertyName,
      )
      onChange(result.mappings)
      applyLookupClears(result.clearedLookupProps)
    },
    [mappings, sources, targets, onChange, applyLookupClears],
  )

  const removeBySource = useCallback(
    (sourceId: string) => {
      const result = removeMappingsForSourceId(mappings, sourceId)
      onChange(result.mappings)
      applyLookupClears(result.clearedLookupProps)
    },
    [mappings, onChange, applyLookupClears],
  )

  const autoMap = useCallback(() => {
    const next = onAutoMap ? onAutoMap() : defaultAutoMap(sources, targets)
    onChange(next)
    setDrafts([])
    setExtraPropertyNames(new Set())
  }, [onAutoMap, sources, targets, onChange])

  const setSource = useCallback(
    (rowId: string, sourceId: string | null) => {
      if (rowKey === 'property') {
        if (!sourceId) {
          const prev = mappings.find((m) => m.propertyName === rowId)
          onChange(mappings.filter((m) => m.propertyName !== rowId))
          if (prev?.resolve === 'lookup') applyLookupClears([rowId])
          return
        }
        const result = connectSourceToProperty(
          mappings,
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
            onChange(upsertPropertyMapping(result.mappings, edge))
            applyLookupClears(result.clearedLookupProps)
            return
          }
        }
        onChange(result.mappings)
        applyLookupClears(result.clearedLookupProps)
        return
      }

      // source mode
      const edgeIndex = edgeIds.indexOf(rowId)
      if (edgeIndex >= 0) {
        if (!sourceId) {
          const prev = mappings[edgeIndex]
          const next = mappings.filter((_, i) => i !== edgeIndex)
          onChange(next)
          if (prev?.resolve === 'lookup') {
            applyLookupClears([prev.propertyName])
          }
          return
        }
        const prev = mappings[edgeIndex]!
        const target = targets.find((t) => t.name === prev.propertyName)
        let edge: FieldMapping = {
          sourceId,
          propertyName: prev.propertyName,
        }
        edge = attachLookupIfNeeded(edge, target)
        if (!edge.resolve) {
          const source = originSources(sources).find((s) => s.id === sourceId)
          const required = computeRequiredResolve(source, target)
          if (required) edge = { ...edge, resolve: required }
        }
        const next = [...mappings]
        next[edgeIndex] = edge
        onChange(next)
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
        const complete = updated.filter((d) => d.sourceId && d.propertyName)
        const incomplete = updated.filter(
          (d) => !(d.sourceId && d.propertyName),
        )
        if (complete.length > 0) {
          onChange([
            ...mappings,
            ...complete.map((d) => ({
              sourceId: d.sourceId!,
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
      mappings,
      sources,
      targets,
      onChange,
      applyLookupClears,
      edgeIds,
    ],
  )

  const setProperty = useCallback(
    (rowId: string, propertyName: string) => {
      if (rowKey === 'property') {
        // Property mode row ids are property names; renaming is add+remove.
        return
      }

      const edgeIndex = edgeIds.indexOf(rowId)
      if (edgeIndex >= 0) {
        const prev = mappings[edgeIndex]!
        const target = targets.find((t) => t.name === propertyName)
        const source = originSources(sources).find(
          (s) => s.id === prev.sourceId,
        )
        let edge: FieldMapping = {
          sourceId: prev.sourceId,
          propertyName,
        }
        edge = attachLookupIfNeeded(edge, target)
        if (!edge.resolve) {
          const required = computeRequiredResolve(source, target)
          if (required) edge = { ...edge, resolve: required }
        }
        const next = [...mappings]
        next[edgeIndex] = edge
        onChange(next)
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
          (d) => d.sourceId && d.propertyName,
        )
        const incomplete = updated.filter(
          (d) => !(d.sourceId && d.propertyName),
        )

        if (complete.length > 0) {
          const promoted: FieldMapping[] = complete.map((d) => ({
            sourceId: d.sourceId!,
            propertyName: d.propertyName!,
            ...(d.resolve ? { resolve: d.resolve } : {}),
          }))
          onChange([...mappings, ...promoted])
          return incomplete
        }
        return updated
      })
    },
    [
      rowKey,
      edgeIds,
      mappings,
      targets,
      sources,
      onChange,
      applyLookupClears,
    ],
  )

  const setTransform = useCallback(
    (rowId: string, resolve: ResolveJob | null) => {
      if (rowKey === 'property') {
        const prev = mappings.find((m) => m.propertyName === rowId)
        if (!prev) return
        const edge: FieldMapping = resolve
          ? { ...prev, resolve }
          : { sourceId: prev.sourceId, propertyName: prev.propertyName }
        onChange(upsertPropertyMapping(mappings, edge))
        if (prev.resolve === 'lookup' && resolve !== 'lookup') {
          applyLookupClears([rowId])
        }
        return
      }

      const edgeIndex = edgeIds.indexOf(rowId)
      if (edgeIndex >= 0) {
        const prev = mappings[edgeIndex]!
        const edge: FieldMapping = resolve
          ? { ...prev, resolve }
          : { sourceId: prev.sourceId, propertyName: prev.propertyName }
        const next = [...mappings]
        next[edgeIndex] = edge
        onChange(next)
        if (prev.resolve === 'lookup' && resolve !== 'lookup') {
          applyLookupClears([prev.propertyName])
        }
        return
      }

      setDrafts((prev) =>
        prev.map((d) =>
          d.id === rowId
            ? { ...d, resolve: resolve ?? undefined }
            : d,
        ),
      )
    },
    [rowKey, mappings, edgeIds, onChange, applyLookupClears],
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
      if (rowKey === 'property') {
        const prev = mappings.find((m) => m.propertyName === rowId)
        onChange(mappings.filter((m) => m.propertyName !== rowId))
        if (prev?.resolve === 'lookup') applyLookupClears([rowId])
        setExtraPropertyNames((prevSet) => {
          if (!prevSet.has(rowId)) return prevSet
          const next = new Set(prevSet)
          next.delete(rowId)
          return next
        })
        return
      }

      const edgeIndex = edgeIds.indexOf(rowId)
      if (edgeIndex >= 0) {
        const prev = mappings[edgeIndex]
        onChange(mappings.filter((_, i) => i !== edgeIndex))
        if (prev?.resolve === 'lookup') {
          applyLookupClears([prev.propertyName])
        }
        return
      }

      setDrafts((prev) => prev.filter((d) => d.id !== rowId))
    },
    [rowKey, mappings, edgeIds, onChange, applyLookupClears],
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
