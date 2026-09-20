import React, { useMemo, useState } from 'react'
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
  slots: ResolvedFieldMapperSlots
  classNames?: Partial<Record<FieldMapperSlot, string>>
  ui?: ResolvedFieldMapperComponents
}

export function PropertyRows({
  sources,
  targets,
  mappings,
  mapper,
  defaultRows = 'requiredAndMapped',
  slots,
  classNames,
  ui = {
    Select: DefaultSelect,
    Button: DefaultButton,
    Pill: DefaultPill,
  },
}: PropertyRowsProps) {
  const Select = ui.Select
  const Button = ui.Button
  const Pill = ui.Pill

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
  const jsonPreview = showJsonPreview(slots.preview)
  const rowPreview = showRowPreview(slots.preview)

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
          {coverage.mapped} of {coverage.total} properties mapped
          {coverage.missingRequired.length > 0
            ? ` · ${coverage.missingRequired.length} required missing`
            : ''}
        </span>
      </div>

      {slots.filter && (
        <div
          className={slotClass('filter', classNames)}
          role="group"
          aria-label="Row filter"
        >
          <Button
            className="fm-btn"
            aria-pressed={filterMode === 'requiredAndMapped'}
            onClick={() => setFilterMode('requiredAndMapped')}
          >
            Mapped + required
          </Button>
          <Button
            className="fm-btn"
            aria-pressed={filterMode === 'all'}
            onClick={() => setFilterMode('all')}
          >
            All {targets.length} properties
          </Button>
        </div>
      )}

      <div className={slotClass('rowList', classNames)}>
        {visibleRows.map((row) => {
          const resolveValue = (row.mapping?.resolve ?? '') as '' | ResolveJob
          return (
            <div
              key={row.id}
              className={slotClass('row', classNames)}
              data-state={row.state}
              data-property-name={row.id}
              data-required={row.target?.required ? 'true' : undefined}
              data-resolve={row.mapping?.resolve}
              data-source-kind={row.source?.kind}
            >
              <div className="fm-row-main">
                <div className="fm-row-prop">
                  <div className={slotClass('propertyLabel', classNames)}>
                    {row.target?.name}
                    {row.target?.required ? ' *' : ''}
                  </div>
                  <Pill className={slotClass('dataType', classNames)}>
                    {row.target?.dataType}
                  </Pill>
                </div>
                <Select
                  className={slotClass('sourceSelect', classNames)}
                  aria-label={`Source for ${row.id}`}
                  value={row.mapping?.sourceId ?? ''}
                  onChange={(v) => {
                    mapper.setSource(row.id, v || null)
                  }}
                >
                  <option value="">Choose a source field…</option>
                  {sourceOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
                {row.mapping?.sourceId ? (
                  <Select
                    className={slotClass('transformSelect', classNames)}
                    aria-label={`Transform for ${row.id}`}
                    value={resolveValue}
                    onChange={(v) => {
                      mapper.setTransform(row.id, (v as ResolveJob) || null)
                    }}
                  >
                    {TRANSFORM_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Pill className={slotClass('dataType', classNames)}>
                    {row.target?.dataType}
                  </Pill>
                )}
                <Button
                  className={slotClass('removeButton', classNames)}
                  aria-label={`Remove mapping for ${row.id}`}
                  onClick={() => mapper.removeRow(row.id)}
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
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 10 }}>
        {adding ? (
          <Select
            className={slotClass('sourceSelect', classNames)}
            aria-label="Add property mapping"
            value=""
            onChange={(name) => {
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
          </Select>
        ) : (
          <Button
            className={slotClass('addButton', classNames)}
            onClick={() => setAdding(true)}
            disabled={addableProperties.length === 0}
          >
            + Add mapping
          </Button>
        )}
      </div>

      {slots.inspector && (
        <details
          className={slotClass('inspector', classNames)}
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
                  <div className="fm-value">
                    {truncateSample(source.value, 60)}
                  </div>
                </div>
                <div className="fm-value">
                  {used.length > 0 ? `→ ${used.join(', ')}` : 'unused'}
                </div>
                <Button
                  className="fm-btn"
                  onClick={() => mapThisSource(source.id)}
                >
                  Map this
                </Button>
              </div>
            )
          })}
        </details>
      )}

      {jsonPreview && previewOpen && (
        <pre className={slotClass('jsonPreview', classNames)}>
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
