import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { applyMapping } from '../applyMapping'
import { autoMap as defaultAutoMap } from '../autoMap'
import type { FieldMapping, SourceNode, TargetProperty } from '../types'

const CONNECTION_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#f97316',
  '#14b8a6',
]

type ConnectorPoint = {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  mapping: FieldMapping
}

export type FieldMapperProps = {
  sources: SourceNode[]
  targets: TargetProperty[]
  mappings: FieldMapping[]
  onChange: (mappings: FieldMapping[]) => void
  /** Override default autoMap heuristics. */
  onAutoMap?: () => FieldMapping[]
  className?: string
  /** Show JSON preview of applyMapping result. Default true. */
  showPreview?: boolean
}

const DATA_TYPE_COLORS: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  String: { bg: 'rgba(59,130,246,0.12)', border: '#3b82f6', text: '#93c5fd' },
  Text: { bg: 'rgba(59,130,246,0.12)', border: '#3b82f6', text: '#93c5fd' },
  Number: { bg: 'rgba(16,185,129,0.12)', border: '#10b981', text: '#6ee7b7' },
  Boolean: { bg: 'rgba(167,139,250,0.12)', border: '#a78bfa', text: '#c4b5fd' },
  Json: { bg: 'rgba(251,191,36,0.12)', border: '#fbbf24', text: '#fcd34d' },
  Date: { bg: 'rgba(244,114,182,0.12)', border: '#f472b6', text: '#f9a8d4' },
  Relation: { bg: 'rgba(34,211,238,0.12)', border: '#22d3ee', text: '#67e8f9' },
}

function getDataTypeStyle(dataType: string) {
  return (
    DATA_TYPE_COLORS[dataType] ?? {
      bg: 'rgba(148,163,184,0.12)',
      border: '#94a3b8',
      text: '#cbd5e1',
    }
  )
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n)}…`
}

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

  const getConnectionColor = useCallback(
    (index: number) => CONNECTION_COLORS[index % CONNECTION_COLORS.length]!,
    [],
  )

  const getConnectorPoints = useCallback((): ConnectorPoint[] => {
    if (!containerRef.current) return []
    const containerRect = containerRef.current.getBoundingClientRect()
    return mappings
      .map((mapping, i) => {
        const sourceEl = sourceRefs.current[mapping.sourceId]
        const propEl = propRefs.current[mapping.propertyName]
        if (!sourceEl || !propEl) return null

        const sR = sourceEl.getBoundingClientRect()
        const pR = propEl.getBoundingClientRect()

        return {
          x1: sR.right - containerRect.left,
          y1: sR.top + sR.height / 2 - containerRect.top,
          x2: pR.left - containerRect.left,
          y2: pR.top + pR.height / 2 - containerRect.top,
          color: getConnectionColor(i),
          mapping,
        }
      })
      .filter((pt): pt is ConnectorPoint => pt !== null)
  }, [mappings, getConnectionColor])

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
    const next = mappings.filter((c) => c.propertyName !== propertyName)
    next.push({ sourceId: activeSource, propertyName })
    onChange(next)
    // Keep source active so the user can attach additional properties.
  }

  const removeMappingsForSource = (sourceId: string) => {
    onChange(mappings.filter((c) => c.sourceId !== sourceId))
  }

  const removeMappingForProp = (propertyName: string) => {
    onChange(mappings.filter((c) => c.propertyName !== propertyName))
  }

  const sourceHasMapping = (sourceId: string) =>
    mappings.some((c) => c.sourceId === sourceId)
  const mappingForProp = (propName: string) =>
    mappings.find((c) => c.propertyName === propName)

  const isEdgeHighlighted = (mapping: FieldMapping) => {
    if (hoveredProp) return mapping.propertyName === hoveredProp
    if (hoveredSource) return mapping.sourceId === hoveredSource
    return false
  }

  const anyEdgeHighlighted = hoveredProp != null || hoveredSource != null


  const preview = useMemo(
    () => applyMapping(sources, mappings, targets),
    [sources, mappings, targets],
  )

  const runAutoMap = () => {
    const next = onAutoMap ? onAutoMap() : defaultAutoMap(sources, targets)
    onChange(next)
  }

  return (
    <div className={`seed-field-mapper ${className ?? ''}`.trim()}>
      <style>{`
        .seed-field-mapper {
          font-family: 'DM Sans', system-ui, sans-serif;
          color: #e2e8f0;
          background: #0f172a;
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
          background: #1e293b;
          border: 1px solid #334155;
          color: #e2e8f0;
          border-radius: 8px;
          padding: 6px 12px;
          cursor: pointer;
          font-size: 13px;
        }
        .seed-field-mapper .fm-btn:hover { border-color: #64748b; }
        .seed-field-mapper .fm-btn-primary {
          background: #2563eb;
          border-color: #3b82f6;
        }
        .seed-field-mapper .fm-meta {
          font-size: 12px;
          color: #94a3b8;
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
          color: #64748b;
          margin-bottom: 8px;
        }
        .seed-field-mapper .fm-card {
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 10px 12px;
          margin-bottom: 8px;
          background: #1e293b;
          cursor: pointer;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .seed-field-mapper .fm-card.active {
          border-color: #3b82f6;
          box-shadow: 0 0 0 1px #3b82f6;
        }
        .seed-field-mapper .fm-card.mapped {
          border-color: #475569;
        }
        .seed-field-mapper .fm-card.highlight {
          border-color: #f59e0b;
        }
        .seed-field-mapper .fm-label {
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 4px;
        }
        .seed-field-mapper .fm-value {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          color: #94a3b8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .seed-field-mapper .fm-kind {
          font-size: 10px;
          color: #64748b;
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
          border: 1px solid;
        }
        .seed-field-mapper .fm-remove {
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 14px;
          padding: 0 4px;
        }
        .seed-field-mapper .fm-remove:hover { color: #f87171; }
        .seed-field-mapper .fm-svg {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: visible;
        }
        .seed-field-mapper .fm-preview {
          margin-top: 12px;
          background: #020617;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 12px;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          white-space: pre-wrap;
          color: #cbd5e1;
          max-height: 200px;
          overflow: auto;
        }
      `}</style>

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
                key={`${pt.mapping.sourceId}-${pt.mapping.propertyName}`}
                d={`M ${pt.x1} ${pt.y1} C ${midX} ${pt.y1}, ${midX} ${pt.y2}, ${pt.x2} ${pt.y2}`}
                stroke={pt.color}
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
            const isActive = activeSource === source.id
            const isHi = hoveredSource === source.id || (
              hoveredProp != null &&
              mappings.some(
                (m) =>
                  m.sourceId === source.id && m.propertyName === hoveredProp,
              )
            )
            return (
              <div
                key={source.id}
                ref={(el) => {
                  sourceRefs.current[source.id] = el
                }}
                className={`fm-card${isActive ? ' active' : ''}${mapped ? ' mapped' : ''}${isHi ? ' highlight' : ''}`}
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
            const style = getDataTypeStyle(prop.dataType)
            const isHi =
              hoveredProp === prop.name ||
              (hoveredSource != null &&
                mapped?.sourceId === hoveredSource)
            return (
              <div
                key={prop.name}
                ref={(el) => {
                  propRefs.current[prop.name] = el
                }}
                className={`fm-card${mapped ? ' mapped' : ''}${isHi ? ' highlight' : ''}${activeSource ? ' active' : ''}`}
                onClick={() => handlePropClick(prop.name)}
                onMouseEnter={() => setHoveredProp(prop.name)}
                onMouseLeave={() => setHoveredProp(null)}
              >
                <div className="fm-prop-row">
                  <div className="fm-label">{prop.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span
                      className="fm-dtype"
                      style={{
                        background: style.bg,
                        borderColor: style.border,
                        color: style.text,
                      }}
                    >
                      {prop.dataType}
                    </span>
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
                  <div className="fm-value">← {mapped.sourceId}</div>
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
