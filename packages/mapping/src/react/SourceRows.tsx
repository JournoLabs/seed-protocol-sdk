import React, { useState } from 'react'
import type { ResolveJob } from '../types'
import type {
  FieldMapperSlot,
  ResolvedFieldMapperComponents,
  ResolvedFieldMapperSlots,
} from './fieldMapperSlots'
import {
  showJsonPreview,
  showRowPreview,
  slotClass,
} from './fieldMapperSlots'
import {
  DefaultButton,
  DefaultPill,
  DefaultSelect,
} from './fieldMapperControls'
import type { UseFieldMapperResult } from './fieldMapperTypes'

const TRANSFORM_OPTIONS: { value: '' | ResolveJob; label: string }[] = [
  { value: '', label: 'copy' },
  { value: 'extract', label: 'extract' },
  { value: 'file', label: 'file' },
  { value: 'lookup', label: 'lookup' },
]

export type SourceRowsProps = {
  mapper: UseFieldMapperResult
  slots: ResolvedFieldMapperSlots
  classNames?: Partial<Record<FieldMapperSlot, string>>
  ui?: ResolvedFieldMapperComponents
}

export function SourceRows({
  mapper,
  slots,
  classNames,
  ui = {
    Select: DefaultSelect,
    Button: DefaultButton,
    Pill: DefaultPill,
  },
}: SourceRowsProps) {
  const Select = ui.Select
  const Button = ui.Button
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

  const jsonPreview = showJsonPreview(slots.preview)
  const rowPreview = showRowPreview(slots.preview)

  return (
    <>
      <div className={slotClass('toolbar', classNames)}>
        {slots.autoMap && (
          <Button
            className={slotClass('autoMapButton', classNames)}
            onClick={() => autoMap()}
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

      <div className={slotClass('rowList', classNames)}>
        {rows.map((row) => {
          const resolveValue = (row.mapping?.resolve ?? '') as '' | ResolveJob
          const sourceValue = row.source?.id ?? row.mapping?.sourceId ?? ''
          const propertyValue =
            row.target?.name ?? row.mapping?.propertyName ?? ''
          return (
            <div
              key={row.id}
              className={slotClass('row', classNames)}
              data-state={row.state}
              data-property-name={propertyValue || undefined}
              data-required={row.target?.required ? 'true' : undefined}
              data-resolve={row.mapping?.resolve}
              data-source-kind={row.source?.kind}
            >
              <div className="fm-row-main fm-row-main-source">
                <Select
                  className={slotClass('sourceSelect', classNames)}
                  aria-label="Source field"
                  value={sourceValue}
                  onChange={(v) => {
                    setSource(row.id, v || null)
                  }}
                >
                  <option value="">Choose a source field…</option>
                  {sourceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                {sourceValue ? (
                  <Select
                    className={slotClass('transformSelect', classNames)}
                    aria-label="Transform"
                    value={resolveValue}
                    onChange={(v) => {
                      setTransform(row.id, (v as ResolveJob) || null)
                    }}
                  >
                    {TRANSFORM_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="fm-into" />
                )}
                <span className="fm-into">into</span>
                <Select
                  className={slotClass('sourceSelect', classNames)}
                  aria-label="Target property"
                  value={propertyValue}
                  onChange={(v) => {
                    if (v) setProperty(row.id, v)
                  }}
                >
                  <option value="">Choose a property…</option>
                  {propertyOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                <Button
                  className={slotClass('removeButton', classNames)}
                  aria-label="Remove row"
                  onClick={() => removeRow(row.id)}
                >
                  ×
                </Button>
              </div>
              {rowPreview && row.preview && (
                <div className={slotClass('preview', classNames)}>
                  {row.preview}
                </div>
              )}
              {row.state === 'needsResolve' && row.requiredResolve && (
                <div className={slotClass('validation', classNames)}>
                  needs {row.requiredResolve}
                </div>
              )}
              {row.state === 'conflict' && (
                <div
                  className={slotClass('validation', classNames)}
                  style={{ color: 'var(--fm-danger)' }}
                >
                  property already mapped by another row
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 10 }}>
        <Button
          className={slotClass('addButton', classNames)}
          onClick={() => addRow()}
        >
          + Add mapping
        </Button>
      </div>

      {jsonPreview && previewOpen && (
        <pre className={slotClass('jsonPreview', classNames)}>
          {JSON.stringify(
            rows.filter((r) => r.mapping).map((r) => r.mapping),
            null,
            2,
          )}
        </pre>
      )}
    </>
  )
}
