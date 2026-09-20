import React, { useMemo, useState } from 'react'
import type {
  FieldMapping,
  MappingLookups,
  ResolveJob,
  SourceNode,
  TargetProperty,
} from '../types'
import {
  filterPropertyNames,
  originSources,
  truncateSample,
} from './fieldMapperCore'
import type {
  FieldMapperDefaultRows,
  UseFieldMapperResult,
} from './fieldMapperTypes'

const TRANSFORM_OPTIONS: { value: '' | ResolveJob; label: string }[] = [
  { value: '', label: 'copy' },
  { value: 'extract', label: 'extract' },
  { value: 'file', label: 'file' },
  { value: 'lookup', label: 'lookup' },
]

export type PropertyRowsProps = {
  sources: SourceNode[]
  targets: TargetProperty[]
  mappings: FieldMapping[]
  mapper: UseFieldMapperResult
  defaultRows?: FieldMapperDefaultRows
  lookups?: MappingLookups
  onLookupsChange?: (lookups: MappingLookups) => void
  showPreview?: boolean
}

export function PropertyRows({
  sources,
  targets,
  mappings,
  mapper,
  defaultRows = 'requiredAndMapped',
  showPreview = true,
}: PropertyRowsProps) {
  const [filterMode, setFilterMode] =
    useState<FieldMapperDefaultRows>(defaultRows)
  const [extraNames, setExtraNames] = useState<Set<string>>(() => new Set())
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const visibleNames = useMemo(
    () => filterPropertyNames(targets, mappings, filterMode, extraNames),
    [targets, mappings, filterMode, extraNames],
  )

  const visibleRows = useMemo(() => {
    if (visibleNames == null) return mapper.rows
    return mapper.rows.filter((r) => visibleNames.has(r.id))
  }, [mapper.rows, visibleNames])

  const usageBySource = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const m of mappings) {
      const list = map.get(m.sourceId) ?? []
      list.push(m.propertyName)
      map.set(m.sourceId, list)
    }
    return map
  }, [mappings])

  const { coverage, sourceOptions, addableProperties } = mapper

  const handleAddProperty = (name: string) => {
    mapper.addRow(name)
    setExtraNames((prev) => new Set(prev).add(name))
    setAdding(false)
  }

  const mapThisSource = (sourceId: string) => {
    setPendingSourceId(sourceId)
    setAdding(true)
  }

  const onPickAddProperty = (name: string) => {
    handleAddProperty(name)
    if (pendingSourceId) {
      mapper.setSource(name, pendingSourceId)
      setPendingSourceId(null)
    }
  }

  return (
    <>
      <div className="fm-toolbar">
        <button
          type="button"
          className="fm-btn fm-btn-primary"
          onClick={() => mapper.autoMap()}
        >
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
          {coverage.mapped} of {coverage.total} properties mapped
          {coverage.missingRequired.length > 0
            ? ` · ${coverage.missingRequired.length} required missing`
            : ''}
        </span>
      </div>

      <div className="fm-filter" role="group" aria-label="Row filter">
        <button
          type="button"
          className="fm-btn"
          aria-pressed={filterMode === 'requiredAndMapped'}
          onClick={() => setFilterMode('requiredAndMapped')}
        >
          Mapped + required
        </button>
        <button
          type="button"
          className="fm-btn"
          aria-pressed={filterMode === 'all'}
          onClick={() => setFilterMode('all')}
        >
          All {targets.length} properties
        </button>
      </div>

      <div className="fm-row-list">
        {visibleRows.map((row) => {
          const resolveValue = (row.mapping?.resolve ?? '') as '' | ResolveJob
          return (
            <div
              key={row.id}
              className="fm-row"
              data-state={row.state}
              data-property-name={row.id}
              data-required={row.target?.required ? 'true' : undefined}
              data-resolve={row.mapping?.resolve}
            >
              <div className="fm-row-main">
                <div className="fm-row-prop">
                  <div className="fm-row-prop-name">
                    {row.target?.name}
                    {row.target?.required ? ' *' : ''}
                  </div>
                  <span className="fm-dtype">{row.target?.dataType}</span>
                </div>
                <select
                  className="fm-select"
                  aria-label={`Source for ${row.id}`}
                  value={row.mapping?.sourceId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    mapper.setSource(row.id, v || null)
                  }}
                >
                  <option value="">Choose a source field…</option>
                  {sourceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {row.mapping?.sourceId ? (
                  <select
                    className="fm-select"
                    aria-label={`Transform for ${row.id}`}
                    value={resolveValue}
                    onChange={(e) => {
                      const v = e.target.value as '' | ResolveJob
                      mapper.setTransform(row.id, v || null)
                    }}
                  >
                    {TRANSFORM_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="fm-dtype">{row.target?.dataType}</span>
                )}
                <button
                  type="button"
                  className="fm-remove"
                  aria-label={`Remove mapping for ${row.id}`}
                  onClick={() => mapper.removeRow(row.id)}
                >
                  ×
                </button>
              </div>
              {row.preview && (
                <div className="fm-row-preview">{row.preview}</div>
              )}
              {row.state === 'needsResolve' && row.requiredResolve && (
                <div className="fm-row-flag">
                  needs {row.requiredResolve}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 10 }}>
        {adding ? (
          <select
            className="fm-select"
            aria-label="Add property mapping"
            defaultValue=""
            onChange={(e) => {
              const name = e.target.value
              if (name) onPickAddProperty(name)
            }}
          >
            <option value="">Choose a property…</option>
            {addableProperties.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.required ? ' *' : ''} ({p.dataType})
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className="fm-btn"
            onClick={() => setAdding(true)}
            disabled={addableProperties.length === 0}
          >
            + Add mapping
          </button>
        )}
      </div>

      <details
        className="fm-inspector"
        open={inspectorOpen}
        onToggle={(e) =>
          setInspectorOpen((e.target as HTMLDetailsElement).open)
        }
      >
        <summary>
          Source fields ({originSources(sources).length})
        </summary>
        {originSources(sources).map((source) => {
          const used = usageBySource.get(source.id) ?? []
          return (
            <div key={source.id} className="fm-inspector-row">
              <div>
                <strong>{source.label}</strong>
                <div className="fm-value">{truncateSample(source.value, 60)}</div>
              </div>
              <div className="fm-value">
                {used.length > 0 ? `→ ${used.join(', ')}` : 'unused'}
              </div>
              <button
                type="button"
                className="fm-btn"
                onClick={() => mapThisSource(source.id)}
              >
                Map this
              </button>
            </div>
          )
        })}
      </details>

      {showPreview && previewOpen && (
        <pre className="fm-preview">
          {JSON.stringify(
            Object.fromEntries(
              mappings.map((m) => [
                m.propertyName,
                {
                  sourceId: m.sourceId,
                  resolve: m.resolve ?? 'copy',
                },
              ]),
            ),
            null,
            2,
          )}
        </pre>
      )}
    </>
  )
}
