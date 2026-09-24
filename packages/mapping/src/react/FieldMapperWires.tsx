import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
import { buildSyncPreviewBag } from './fieldMapperCore'
import type {
  FieldMapperLookupRow,
  UseFieldMapperResult,
} from './fieldMapperTypes'
import { LookupEditor } from './LookupEditor'
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

function displaySourceIdForMapping(
  mapping: FieldMapping,
  sources: SourceNode[],
): string {
  if (!mapping.sourceId) return ''
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
  renderLookup?: (row: FieldMapperLookupRow) => React.ReactNode
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
  onLookupsChange,
  renderLookup,
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
      if (!m.sourceId) return
      const displayId = displaySourceIdForMapping(m, sources)
      for (const key of new Set([m.sourceId, displayId])) {
        const list = map.get(key) ?? []
        list.push(i)
        map.set(key, list)
      }
    })
    return map
  }, [mappings, sources])

  const getConnectorPoints = useCallback((): ConnectorPoint[] => {
    if (!containerRef.current) return []
    const containerRect = containerRef.current.getBoundingClientRect()
    return mappings
      .map((mapping, i) => {
        if (!mapping.sourceId) return null
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

  const preview = useMemo(
    () => buildSyncPreviewBag(sources, mappings, targets),
    [sources, mappings, targets],
  )

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
                    {source.subtitle ? (
                      <span className="fm-kind">{source.subtitle}</span>
                    ) : null}
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
        renderLookup &&
        mapper.rows
          .filter((row) => row.mapping?.resolve === 'lookup')
          .map((row) => (
            <div
              key={row.id}
              className={slotClass('lookupEditor', classNames)}
            >
              {renderLookup({
                ...row,
                sampleValue: row.sampleValue ?? '',
                onLookupChange: (entries) =>
                  mapper.setLookupEntries(row.id, entries),
              })}
            </div>
          ))}
      {slots.lookups === 'section' && !renderLookup && onLookupsChange && (
        <LookupEditor
          mode="section"
          mappings={mappings}
          sources={sources}
          targets={targets}
          onLookupChange={(mapping, entries) => {
            const row = mapper.rows.find(
              (r) =>
                r.mapping?.sourceId === mapping.sourceId &&
                r.mapping?.propertyName === mapping.propertyName,
            )
            if (row) mapper.setLookupEntries(row.id, entries)
          }}
          classNames={classNames}
        />
      )}

      {jsonPreview && (
        <details
          className={slotClass('jsonPreview', classNames)}
          open={previewOpen}
          onToggle={(e) =>
            setPreviewOpen((e.target as HTMLDetailsElement).open)
          }
        >
          <summary>Preview JSON</summary>
          <pre className="fm-preview-body">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </details>
      )}
    </>
  )
}
