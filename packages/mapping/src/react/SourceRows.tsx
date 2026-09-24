import React, { useMemo, useState, type ReactNode } from 'react'
import type {
  FieldMapping,
  MappingLookups,
  ResolveJob,
  SourceNode,
  TargetProperty,
} from '../types'
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
import { buildSyncPreviewBag } from './fieldMapperCore'
import type {
  FieldMapperLookupRow,
  FieldMapperRow,
  FieldMapperTransformOptions,
  UseFieldMapperResult,
} from './fieldMapperTypes'
import {
  isTransformSelectDisabled,
  resolveTransformOptions,
  showTransformSelect,
} from './fieldMapperTransforms'
import { LookupEditor } from './LookupEditor'

export type SourceRowsProps = {
  sources: SourceNode[]
  targets: TargetProperty[]
  mappings: FieldMapping[]
  mapper: UseFieldMapperResult
  lookups?: MappingLookups
  onLookupsChange?: (lookups: MappingLookups) => void
  slots: ResolvedFieldMapperSlots
  classNames?: Partial<Record<FieldMapperSlot, string>>
  ui?: ResolvedFieldMapperComponents
  renderRowAccessory?: (row: FieldMapperRow) => ReactNode
  renderLookup?: (row: FieldMapperLookupRow) => ReactNode
  renderRowExpansion?: (row: FieldMapperRow) => ReactNode
  transformOptions?: FieldMapperTransformOptions
}

export function SourceRows({
  sources,
  targets,
  mappings,
  mapper,
  onLookupsChange,
  slots,
  classNames,
  ui = {
    Select: DefaultSelect,
    Button: DefaultButton,
    Pill: DefaultPill,
  },
  renderRowAccessory,
  renderLookup,
  renderRowExpansion,
  transformOptions,
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

  const syncPreview = useMemo(
    () => buildSyncPreviewBag(sources, mappings, targets),
    [sources, mappings, targets],
  )

  const jsonPreview = showJsonPreview(slots.preview)
  const rowPreview = showRowPreview(slots.preview)
  const showRowLookups =
    slots.lookups === 'row' && (Boolean(renderLookup) || Boolean(onLookupsChange))
  const showSectionLookups =
    slots.lookups === 'section' &&
    !renderLookup &&
    Boolean(onLookupsChange)

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
          const transformOpts = resolveTransformOptions(row, transformOptions)
          const showTransform = showTransformSelect(row, transformOpts)
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
                {showTransform ? (
                  <Select
                    className={slotClass('transformSelect', classNames)}
                    aria-label="Transform"
                    value={resolveValue}
                    disabled={isTransformSelectDisabled(row)}
                    onChange={(v) => {
                      setTransform(row.id, (v as ResolveJob) || null)
                    }}
                  >
                    {transformOpts.map((opt) => (
                      <option
                        key={opt.label}
                        value={opt.value}
                        disabled={opt.disabled}
                      >
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
                <div className={slotClass('rowAccessory', classNames)}>
                  {renderRowAccessory?.(row) ?? null}
                </div>
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
              {row.state === 'needsLookup' && (
                <div className={slotClass('validation', classNames)}>
                  needs lookup
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
              {showRowLookups &&
                row.mapping?.resolve === 'lookup' &&
                row.mapping &&
                (renderLookup ? (
                  <div className={slotClass('lookupEditor', classNames)}>
                    {renderLookup({
                      ...row,
                      sampleValue: row.sampleValue ?? '',
                      onLookupChange: (entries) =>
                        mapper.setLookupEntries(row.id, entries),
                    })}
                  </div>
                ) : (
                  <LookupEditor
                    mode="row"
                    mappings={[row.mapping]}
                    sources={sources}
                    targets={targets}
                    onLookupChange={(_mapping, entries) =>
                      mapper.setLookupEntries(row.id, entries)
                    }
                    classNames={classNames}
                  />
                ))}
              <div className={slotClass('rowExpansion', classNames)}>
                {renderRowExpansion?.(row) ?? null}
              </div>
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

      {showSectionLookups && (
        <LookupEditor
          mode="section"
          mappings={mappings}
          sources={sources}
          targets={targets}
          onLookupChange={(mapping, entries) => {
            const match = mapper.rows.find(
              (r) =>
                r.mapping?.sourceId === mapping.sourceId &&
                r.mapping?.propertyName === mapping.propertyName,
            )
            if (match) mapper.setLookupEntries(match.id, entries)
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
            {JSON.stringify(syncPreview, null, 2)}
          </pre>
        </details>
      )}
    </>
  )
}
