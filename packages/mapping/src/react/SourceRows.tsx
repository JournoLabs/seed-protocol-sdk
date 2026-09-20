import React, { useState } from 'react'
import type { ResolveJob } from '../types'
import type { UseFieldMapperResult } from './fieldMapperTypes'

const TRANSFORM_OPTIONS: { value: '' | ResolveJob; label: string }[] = [
  { value: '', label: 'copy' },
  { value: 'extract', label: 'extract' },
  { value: 'file', label: 'file' },
  { value: 'lookup', label: 'lookup' },
]

export type SourceRowsProps = {
  mapper: UseFieldMapperResult
  showPreview?: boolean
}

export function SourceRows({
  mapper,
  showPreview = true,
}: SourceRowsProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const {
    rows,
    sourceOptions,
    propertyOptions,
    coverage,
    conflicts,
    setSource,
    setProperty,
    setTransform,
    addRow,
    removeRow,
    autoMap,
  } = mapper

  return (
    <>
      <div className="fm-toolbar">
        <button
          type="button"
          className="fm-btn fm-btn-primary"
          onClick={() => autoMap()}
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
          {coverage.mapped} of {coverage.total} mapped
          {coverage.missingRequired.length > 0
            ? ` · ${coverage.missingRequired.length} required missing: ${coverage.missingRequired.join(', ')}`
            : ''}
        </span>
      </div>

      {conflicts.size > 0 && (
        <div className="fm-banner fm-banner-danger" role="alert">
          {conflicts.size} row{conflicts.size === 1 ? '' : 's'} claim the same
          property — each property can only have one source.
        </div>
      )}

      {coverage.missingRequired.length > 0 && (
        <div className="fm-banner fm-banner-warn" role="status">
          Required missing: {coverage.missingRequired.join(', ')}
        </div>
      )}

      <div className="fm-row-list">
        {rows.map((row) => {
          const resolveValue = (row.mapping?.resolve ?? '') as '' | ResolveJob
          const sourceValue = row.source?.id ?? row.mapping?.sourceId ?? ''
          const propertyValue =
            row.target?.name ?? row.mapping?.propertyName ?? ''
          return (
            <div
              key={row.id}
              className="fm-row"
              data-state={row.state}
              data-resolve={row.mapping?.resolve}
            >
              <div className="fm-row-main fm-row-main-source">
                <select
                  className="fm-select"
                  aria-label="Source field"
                  value={sourceValue}
                  onChange={(e) => {
                    const v = e.target.value
                    setSource(row.id, v || null)
                  }}
                >
                  <option value="">Choose a source field…</option>
                  {sourceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {sourceValue ? (
                  <select
                    className="fm-select"
                    aria-label="Transform"
                    value={resolveValue}
                    onChange={(e) => {
                      const v = e.target.value as '' | ResolveJob
                      setTransform(row.id, v || null)
                    }}
                  >
                    {TRANSFORM_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="fm-into" />
                )}
                <span className="fm-into">into</span>
                <select
                  className="fm-select"
                  aria-label="Target property"
                  value={propertyValue}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v) setProperty(row.id, v)
                  }}
                >
                  <option value="">Choose a property…</option>
                  {propertyOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="fm-remove"
                  aria-label="Remove row"
                  onClick={() => removeRow(row.id)}
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
              {row.state === 'conflict' && (
                <div className="fm-row-flag" style={{ color: 'var(--fm-danger)' }}>
                  property already mapped by another row
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 10 }}>
        <button type="button" className="fm-btn" onClick={() => addRow()}>
          + Add mapping
        </button>
      </div>

      {showPreview && previewOpen && (
        <pre className="fm-preview">
          {JSON.stringify(
            rows
              .filter((r) => r.mapping)
              .map((r) => r.mapping),
            null,
            2,
          )}
        </pre>
      )}
    </>
  )
}
