import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { applyMapping } from '../applyMapping'
import { autoMap as defaultAutoMap } from '../autoMap'
import {
  normalizeMappingFromSourceId,
  parseResolvedSourceId,
  resolvedSourceId,
} from '../resolvedSources'
import type { FieldMapping, SourceNode, TargetProperty } from '../types'

/** Number of cycling pair / map-color slots (`--fm-map-1` … `--fm-map-8`). */
export const FIELD_MAPPER_PAIR_SLOTS = 8

export type FieldMapperTheme = 'default' | 'unstyled'

type ConnectorPoint = {
  x1: number
  y1: number
  x2: number
  y2: number
  stroke: string
  mappingIndex: number
  mapping: FieldMapping
}

export type FieldMapperProps = {
  /**
   * Source nodes to display. Pass `buildResolvedSourceNodes(sources)` to show
   * extract/file candidates; connecting those nodes persists `resolve` on the edge.
   */
  sources: SourceNode[]
  targets: TargetProperty[]
  mappings: FieldMapping[]
  onChange: (mappings: FieldMapping[]) => void
  /** Override default autoMap heuristics. */
  onAutoMap?: () => FieldMapping[]
  className?: string
  /**
   * `default` injects a self-contained dark theme (CSS variables + rules).
   * `unstyled` skips injected paint — host styles structural classes / CSS vars.
   */
  theme?: FieldMapperTheme
  /**
   * Optional connector stroke colors. When omitted, strokes use
   * `var(--fm-map-N, var(--map-N, currentColor))` for N = 1…8.
   */
  connectionColors?: string[]
  /** Show JSON preview of applyMapping result. Default true. */
  showPreview?: boolean
}

/** Display id for connector endpoints (derived nodes for resolve edges). */
function displaySourceIdForMapping(
  mapping: FieldMapping,
  sources: SourceNode[],
): string {
  if (!mapping.resolve) return mapping.sourceId
  const derived = resolvedSourceId(mapping.sourceId, mapping.resolve)
  if (sources.some((s) => s.id === derived)) return derived
  return mapping.sourceId
}

function pairSlot(index: number): number {
  return index % FIELD_MAPPER_PAIR_SLOTS
}

/** Stroke for mapping index `i` — CSS vars by default so hosts can theme. */
export function connectionStrokeForIndex(
  index: number,
  connectionColors?: string[],
): string {
  if (connectionColors && connectionColors.length > 0) {
    return connectionColors[index % connectionColors.length]!
  }
  const n = pairSlot(index) + 1
  return `var(--fm-map-${n}, var(--map-${n}, currentColor))`
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n)}…`
}

const DEFAULT_THEME_CSS = `
.seed-field-mapper {
  --fm-ground: #0f172a;
  --fm-ink: #e2e8f0;
  --fm-well: #1e293b;
  --fm-line: #334155;
  --fm-muted: #94a3b8;
  --fm-faint: #64748b;
  --fm-selection: #3b82f6;
  --fm-highlight: #f59e0b;
  --fm-danger: #f87171;
  --fm-map-1: #3b82f6;
  --fm-map-2: #8b5cf6;
  --fm-map-3: #ec4899;
  --fm-map-4: #f59e0b;
  --fm-map-5: #10b981;
  --fm-map-6: #06b6d4;
  --fm-map-7: #f97316;
  --fm-map-8: #14b8a6;
  font-family: 'DM Sans', system-ui, sans-serif;
  color: var(--fm-ink);
  background: var(--fm-ground);
  border-radius: 12px;
  padding: 16px;
}
.seed-field-mapper * { box-sizing: border-box; }
.seed-field-mapper .fm-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.seed-field-mapper .fm-btn {
  background: var(--fm-well);
  border: 1px solid var(--fm-line);
  color: var(--fm-ink);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.seed-field-mapper .fm-btn:hover { border-color: var(--fm-faint); }
.seed-field-mapper .fm-btn-primary {
  background: var(--fm-selection);
  border-color: var(--fm-selection);
}
.seed-field-mapper .fm-meta {
  font-size: 12px;
  color: var(--fm-muted);
  margin-left: auto;
}
.seed-field-mapper .fm-grid {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
  min-height: 240px;
}
.seed-field-mapper .fm-col-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fm-faint);
  margin-bottom: 8px;
}
.seed-field-mapper .fm-card {
  border: 1px solid var(--fm-line);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--fm-well);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.seed-field-mapper .fm-card.active,
.seed-field-mapper .fm-card.pending {
  border-color: var(--fm-selection);
  box-shadow: 0 0 0 1px var(--fm-selection);
}
.seed-field-mapper .fm-card.mapped {
  border-color: var(--fm-faint);
}
.seed-field-mapper .fm-card.highlight {
  border-color: var(--fm-highlight);
}
.seed-field-mapper .fm-label {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
}
.seed-field-mapper .fm-value {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--fm-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.seed-field-mapper .fm-kind {
  font-size: 10px;
  color: var(--fm-faint);
  margin-left: 6px;
}
.seed-field-mapper .fm-prop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.seed-field-mapper .fm-dtype {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--fm-line);
  color: var(--fm-muted);
  background: transparent;
}
.seed-field-mapper .fm-remove {
  background: transparent;
  border: none;
  color: var(--fm-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}
.seed-field-mapper .fm-remove:hover { color: var(--fm-danger); }
.seed-field-mapper .fm-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
.seed-field-mapper .fm-preview {
  margin-top: 12px;
  background: color-mix(in srgb, var(--fm-ground) 80%, black);
  border: 1px solid var(--fm-line);
  border-radius: 8px;
  padding: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  color: var(--fm-ink);
  max-height: 200px;
  overflow: auto;
}
`

/**
 * Generic two-pane field mapper. Props-driven; no Seed hooks or routing.
 */
export function FieldMapper({
  sources,
  targets,
  mappings,
  onChange,
  onAutoMap,
  className,
  theme = 'default',
  connectionColors,
  showPreview = true,
}: FieldMapperProps) {
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
    // Property exclusive: replace any edge for this property; keep other
    // edges from the active source so one source can fan out to many props.
    // Derived @extract/@file nodes normalize to originId + resolve.
    const edge = normalizeMappingFromSourceId(activeSource, propertyName)
    const next = mappings.filter((c) => c.propertyName !== propertyName)
    next.push(edge)
    onChange(next)
    // Keep source active so the user can attach additional properties.
  }

  const removeMappingsForSource = (sourceId: string) => {
    const parsed = parseResolvedSourceId(sourceId)
    onChange(
      mappings.filter((c) => {
        if (parsed) {
          return !(
            c.sourceId === parsed.originId && c.resolve === parsed.resolve
          )
        }
        return c.sourceId !== sourceId
      }),
    )
  }

  const removeMappingForProp = (propertyName: string) => {
    onChange(mappings.filter((c) => c.propertyName !== propertyName))
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

  const runAutoMap = () => {
    const next = onAutoMap ? onAutoMap() : defaultAutoMap(sources, targets)
    onChange(next)
  }

  const rootClass = [
    'seed-field-mapper',
    theme === 'unstyled' ? 'seed-field-mapper--unstyled' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClass} data-theme={theme}>
      {theme === 'default' && <style>{DEFAULT_THEME_CSS}</style>}

      <div className="fm-toolbar">
        <button type="button" className="fm-btn fm-btn-primary" onClick={runAutoMap}>
          Auto-map
        </button>
        {showPreview && (
          <button
            type="button"
            className="fm-btn"
            onClick={() => setPreviewOpen((v) => !v)}
          >
            {previewOpen ? 'Hide preview' : 'Preview JSON'}
          </button>
        )}
        <span className="fm-meta">
          {mappings.length} / {targets.length} mapped
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
            const isHi = hoveredSource === source.id || (
              hoveredProp != null &&
              mappings.some((m) => {
                const displayId = displaySourceIdForMapping(m, sources)
                return (
                  (m.sourceId === source.id || displayId === source.id) &&
                  m.propertyName === hoveredProp
                )
              })
            )
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
                    <button
                      type="button"
                      className="fm-remove"
                      aria-label="Remove all mappings for source"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeMappingsForSource(source.id)
                      }}
                    >
                      ×
                    </button>
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
                    <span className="fm-dtype">{prop.dataType}</span>
                    {mapped && (
                      <button
                        type="button"
                        className="fm-remove"
                        aria-label="Remove mapping for property"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeMappingForProp(prop.name)
                        }}
                      >
                        ×
                      </button>
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

      {showPreview && previewOpen && (
        <pre className="fm-preview">{JSON.stringify(preview, null, 2)}</pre>
      )}
    </div>
  )
}

export default FieldMapper
