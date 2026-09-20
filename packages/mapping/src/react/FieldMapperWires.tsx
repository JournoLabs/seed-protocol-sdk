import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { applyMapping } from '../applyMapping'
import { normalizeLookupKey } from '../relationLookup'
import {
  parseResolvedSourceId,
  resolvedSourceId,
} from '../resolvedSources'
import type {
  FieldMapping,
  MappingLookups,
  SourceNode,
  TargetProperty,
} from '../types'
import type {
  FieldMapperSlot,
  ResolvedFieldMapperComponents,
  ResolvedFieldMapperSlots,
} from './fieldMapperSlots'
import { showJsonPreview, slotClass } from './fieldMapperSlots'
import {
  DefaultButton,
  DefaultPill,
  DefaultSelect,
} from './fieldMapperControls'
import type { UseFieldMapperResult } from './fieldMapperTypes'
import {
  connectionStrokeForIndex,
  pairSlot,
} from './fieldMapperTheme'

type ConnectorPoint = {
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: string
  mappingIndex: number
  mapping: FieldMapping
}

function parseUidInput(raw: string): string | string[] {
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!
  return parts
}

function formatUidValue(value: string | string[] | undefined): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.join(', ')
  return value
}

function displaySourceIdForMapping(
  mapping: FieldMapping,
  sources: SourceNode[],
): string {
  if (!mapping.resolve) return mapping.sourceId
  const derived = resolvedSourceId(mapping.sourceId, mapping.resolve)
  if (sources.some((s) => s.id === derived)) return derived
  return mapping.sourceId
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n)}…`
}

export type FieldMapperWiresProps = {
  sources: SourceNode[]
  targets: TargetProperty[]
  mappings: FieldMapping[]
  mapper: UseFieldMapperResult
  lookups?: MappingLookups
  onLookupsChange?: (lookups: MappingLookups) => void
  /** @deprecated Prefer CSS map tokens. */
  connectionColors?: string[]
  slots: ResolvedFieldMapperSlots
  classNames?: Partial<Record<FieldMapperSlot, string>>
  ui?: ResolvedFieldMapperComponents
}

export function FieldMapperWires({
  sources,
  targets,
  mappings,
  mapper,
  lookups = {},
  onLookupsChange,
  connectionColors,
  slots,
  classNames,
  ui = {
    Select: DefaultSelect,
    Button: DefaultButton,
    Pill: DefaultPill,
  },
}: FieldMapperWiresProps) {
  const Button = ui.Button
  const [activeSource, setActiveSource] = useState<string | null>(null)
  const [hoveredProp, setHoveredProp] = useState<string | null>(null)
  const [hoveredSource, setHoveredSource] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 })
  const [connectorPoints, setConnectorPoints] = useState<ConnectorPoint[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const sourceRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const propRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const targetsByName = useMemo(() => {
    const map = new Map<string, TargetProperty>()
    for (const t of targets) map.set(t.name, t)
    return map
  }, [targets])

  const lookupMappings = useMemo(
    () => mappings.filter((m) => m.resolve === 'lookup'),
    [mappings],
  )

  const mappingIndexByProp = useMemo(() => {
    const map = new Map<string, number>()
    mappings.forEach((m, i) => {
      map.set(m.propertyName, i)
    })
    return map
  }, [mappings])

  const mappingIndexesBySource = useMemo(() => {
    const map = new Map<string, number[]>()
    mappings.forEach((m, i) => {
      const displayId = displaySourceIdForMapping(m, sources)
      for (const key of new Set([m.sourceId, displayId])) {
        const list = map.get(key) ?? []
        list.push(i)
        map.set(key, list)
      }
    })
    return map
  }, [mappings, sources])

  const setLookupEntry = (
    propertyName: string,
    sourceKey: string,
    uidRaw: string,
  ) => {
    if (!onLookupsChange) return
    const table = { ...(lookups[propertyName] ?? {}) }
    const parsed = parseUidInput(uidRaw)
    if (parsed === '' || (Array.isArray(parsed) && parsed.length === 0)) {
      delete table[sourceKey]
    } else {
      table[sourceKey] = parsed
    }
    const next = { ...lookups }
    if (Object.keys(table).length === 0) {
      delete next[propertyName]
    } else {
      next[propertyName] = table
    }
    onLookupsChange(next)
  }

  const getConnectorPoints = useCallback((): ConnectorPoint[] => {
    if (!containerRef.current) return []
    const containerRect = containerRef.current.getBoundingClientRect()
    return mappings
      .map((mapping, i) => {
        const displayId = displaySourceIdForMapping(mapping, sources)
        const sourceEl =
          sourceRefs.current[displayId] ?? sourceRefs.current[mapping.sourceId]
        const propEl = propRefs.current[mapping.propertyName]
        if (!sourceEl || !propEl) return null

        const sR = sourceEl.getBoundingClientRect()
        const pR = propEl.getBoundingClientRect()

        return {
          x1: sR.right - containerRect.left,
          y1: sR.top + sR.height / 2 - containerRect.top,
          x2: pR.left - containerRect.left,
          y2: pR.top + pR.height / 2 - containerRect.top,
          stroke: connectionStrokeForIndex(i, connectionColors),
          mappingIndex: i,
          mapping,
        }
      })
      .filter((pt): pt is ConnectorPoint => pt !== null)
  }, [mappings, connectionColors, sources])

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setSvgDimensions({ width: rect.width, height: rect.height })
      }
      setConnectorPoints(getConnectorPoints())
    }
    update()
    window.addEventListener('resize', update)
    const timer = setInterval(update, 200)
    return () => {
      window.removeEventListener('resize', update)
      clearInterval(timer)
    }
  }, [getConnectorPoints, mappings, sources, targets])

  const handleSourceClick = (sourceId: string) => {
    setActiveSource((prev) => (prev === sourceId ? null : sourceId))
  }

  const handlePropClick = (propertyName: string) => {
    if (!activeSource) return
    mapper.connect(activeSource, propertyName)
  }

  const sourceHasMapping = (sourceId: string) => {
    const parsed = parseResolvedSourceId(sourceId)
    if (parsed) {
      return mappings.some(
        (c) =>
          c.sourceId === parsed.originId && c.resolve === parsed.resolve,
      )
    }
    return mappings.some((c) => c.sourceId === sourceId)
  }
  const mappingForProp = (propName: string) =>
    mappings.find((c) => c.propertyName === propName)

  const isEdgeHighlighted = (mapping: FieldMapping) => {
    if (hoveredProp) return mapping.propertyName === hoveredProp
    if (hoveredSource) {
      const displayId = displaySourceIdForMapping(mapping, sources)
      return (
        mapping.sourceId === hoveredSource || displayId === hoveredSource
      )
    }
    return false
  }

  const anyEdgeHighlighted = hoveredProp != null || hoveredSource != null

  const pendingResolve = useMemo(
    () => mappings.filter((m) => m.resolve),
    [mappings],
  )

  const preview = useMemo(() => {
    const bag = applyMapping(sources, mappings, targets)
    if (pendingResolve.length === 0) return bag
    return {
      ...bag,
      _pendingResolve: pendingResolve.map((m) => ({
        propertyName: m.propertyName,
        sourceId: m.sourceId,
        resolve: m.resolve,
      })),
    }
  }, [sources, mappings, targets, pendingResolve])

  const { coverage } = mapper
  const jsonPreview = showJsonPreview(slots.preview)

  return (
    <>
      <div className={slotClass('toolbar', classNames)}>
        {slots.autoMap && (
          <Button
            className={slotClass('autoMapButton', classNames)}
            onClick={() => mapper.autoMap()}
          >
            Auto-map
          </Button>
        )}
        {jsonPreview && (
          <Button
            className="fm-btn"
            onClick={() => setPreviewOpen((v) => !v)}
          >
            {previewOpen ? 'Hide preview' : 'Preview JSON'}
          </Button>
        )}
        <span className={slotClass('coverage', classNames)}>
          {coverage.mapped} / {coverage.total} mapped
          {coverage.missingRequired.length > 0
            ? ` · ${coverage.missingRequired.length} required missing`
            : ''}
          {activeSource
            ? ' · click properties (source stays selected)'
            : ' · click a source'}
        </span>
      </div>

      <div className="fm-grid" ref={containerRef}>
        <svg
          className="fm-svg"
          width={svgDimensions.width}
          height={svgDimensions.height}
        >
          {connectorPoints.map((pt) => {
            const isHi = isEdgeHighlighted(pt.mapping)
            const midX = (pt.x1 + pt.x2) / 2
            return (
              <path
                key={`${pt.mapping.sourceId}-${pt.mapping.propertyName}-${pt.mapping.resolve ?? 'copy'}`}
                className="fm-connector"
                data-mapping-index={pt.mappingIndex}
                data-pair={pairSlot(pt.mappingIndex)}
                d={`M ${pt.x1} ${pt.y1} C ${midX} ${pt.y1}, ${midX} ${pt.y2}, ${pt.x2} ${pt.y2}`}
                stroke={pt.stroke}
                strokeWidth={isHi ? 3 : 2}
                fill="none"
                opacity={anyEdgeHighlighted && !isHi ? 0.25 : 0.85}
              />
            )
          })}
        </svg>

        <div>
          <div className="fm-col-title">Sources</div>
          {sources.map((source) => {
            const mapped = sourceHasMapping(source.id)
            const isPending = activeSource === source.id
            const indexes = mappingIndexesBySource.get(source.id) ?? []
            const firstIndex = indexes[0]
            const isHi =
              hoveredSource === source.id ||
              (hoveredProp != null &&
                mappings.some((m) => {
                  const displayId = displaySourceIdForMapping(m, sources)
                  return (
                    (m.sourceId === source.id || displayId === source.id) &&
                    m.propertyName === hoveredProp
                  )
                }))
            return (
              <div
                key={source.id}
                ref={(el) => {
                  sourceRefs.current[source.id] = el
                }}
                className={`fm-card${isPending ? ' active pending' : ''}${mapped ? ' mapped' : ''}${isHi ? ' highlight' : ''}`}
                data-source-id={source.id}
                {...(indexes.length > 0
                  ? {
                      'data-mapping-index': indexes.join(' '),
                      'data-pair': String(pairSlot(firstIndex!)),
                    }
                  : {})}
                onClick={() => handleSourceClick(source.id)}
                onMouseEnter={() => setHoveredSource(source.id)}
                onMouseLeave={() => setHoveredSource(null)}
              >
                <div className="fm-prop-row">
                  <div className="fm-label">
                    {source.label}
                    <span className="fm-kind">{source.kind}</span>
                  </div>
                  {mapped && (
                    <Button
                      className={slotClass('removeButton', classNames)}
                      aria-label="Remove all mappings for source"
                      onClick={(e) => {
                        e.stopPropagation()
                        mapper.removeBySource(source.id)
                      }}
                    >
                      ×
                    </Button>
                  )}
                </div>
                <div className="fm-value">{truncate(source.value, 80)}</div>
              </div>
            )
          })}
        </div>

        <div>
          <div className="fm-col-title">Model properties</div>
          {targets.map((prop) => {
            const mapped = mappingForProp(prop.name)
            const mappingIndex = mappingIndexByProp.get(prop.name)
            const isHi =
              hoveredProp === prop.name ||
              (hoveredSource != null &&
                mapped != null &&
                (mapped.sourceId === hoveredSource ||
                  displaySourceIdForMapping(mapped, sources) ===
                    hoveredSource))
            return (
              <div
                key={prop.name}
                ref={(el) => {
                  propRefs.current[prop.name] = el
                }}
                className={`fm-card${mapped ? ' mapped' : ''}${isHi ? ' highlight' : ''}`}
                data-property-name={prop.name}
                {...(mappingIndex != null
                  ? {
                      'data-mapping-index': String(mappingIndex),
                      'data-pair': String(pairSlot(mappingIndex)),
                    }
                  : {})}
                onClick={() => handlePropClick(prop.name)}
                onMouseEnter={() => setHoveredProp(prop.name)}
                onMouseLeave={() => setHoveredProp(null)}
              >
                <div className="fm-prop-row">
                  <div className="fm-label">{prop.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="fm-dtype">
                      {prop.dataType}
                      {prop.ref ? ` → ${prop.ref}` : ''}
                    </span>
                    {mapped && (
                      <Button
                        className={slotClass('removeButton', classNames)}
                        aria-label="Remove mapping for property"
                        onClick={(e) => {
                          e.stopPropagation()
                          mapper.removeRow(prop.name)
                        }}
                      >
                        ×
                      </Button>
                    )}
                  </div>
                </div>
                {mapped && (
                  <div className="fm-value">
                    ← {mapped.sourceId}
                    {mapped.resolve ? ` (${mapped.resolve})` : ''}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {slots.lookups === 'section' &&
        lookupMappings.length > 0 &&
        onLookupsChange && (
        <div className={slotClass('lookupEditor', classNames)}>
          <div className="fm-lookups-title">Relation lookups</div>
          {lookupMappings.map((mapping) => {
            const source = sources.find((s) => s.id === mapping.sourceId)
            const sampleKey = normalizeLookupKey(
              source?.value || source?.label || '',
            )
            const table = lookups[mapping.propertyName] ?? {}
            const keys = new Set<string>(Object.keys(table))
            if (sampleKey) keys.add(sampleKey)
            const keyList = [...keys]
            const target = targetsByName.get(mapping.propertyName)
            return (
              <div
                key={`${mapping.sourceId}-${mapping.propertyName}`}
                className="fm-lookup-block"
              >
                <h4>
                  {mapping.propertyName}
                  {target?.ref ? ` → ${target.ref}` : ''}
                </h4>
                <div className="fm-lookup-hint">
                  Map source strings to seed UIDs
                  {target?.dataType === 'List'
                    ? ' (comma-separate for multiple)'
                    : ''}
                  . Host owns Identity search/create.
                </div>
                {keyList.length === 0 ? (
                  <div className="fm-lookup-hint">
                    No sample value yet — paste a source string key after
                    connecting.
                  </div>
                ) : (
                  keyList.map((key) => (
                    <div key={key} className="fm-lookup-row">
                      <div className="fm-lookup-key" title={key}>
                        {key || '(empty)'}
                      </div>
                      <input
                        className="fm-lookup-input"
                        type="text"
                        placeholder="seed uid"
                        value={formatUidValue(table[key])}
                        onChange={(e) =>
                          setLookupEntry(
                            mapping.propertyName,
                            key,
                            e.target.value,
                          )
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}

      {jsonPreview && previewOpen && (
        <pre className={slotClass('jsonPreview', classNames)}>
          {JSON.stringify(preview, null, 2)}
        </pre>
      )}
    </>
  )
}
