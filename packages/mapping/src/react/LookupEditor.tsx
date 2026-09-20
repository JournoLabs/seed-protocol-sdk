import React, { useMemo } from 'react'
import { normalizeLookupKey } from '../relationLookup'
import type {
  FieldMapping,
  MappingLookups,
  SourceNode,
  TargetProperty,
} from '../types'
import type { FieldMapperSlot } from './fieldMapperSlots'
import { slotClass } from './fieldMapperSlots'

export function parseUidInput(raw: string): string | string[] {
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!
  return parts
}

export function formatUidValue(value: string | string[] | undefined): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.join(', ')
  return value
}

export function setLookupEntry(
  lookups: MappingLookups,
  propertyName: string,
  sourceKey: string,
  uidRaw: string,
): MappingLookups {
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
  return next
}

export type LookupEditorProps = {
  mode: 'section' | 'row'
  /** Lookup edges to edit. Section: all lookup mappings; row: one property. */
  mappings: FieldMapping[]
  sources: SourceNode[]
  targets: TargetProperty[]
  lookups: MappingLookups
  onLookupsChange: (lookups: MappingLookups) => void
  classNames?: Partial<Record<FieldMapperSlot, string>>
  /** Extra class on the root (e.g. nested-in-row modifier). */
  className?: string
}

function LookupBlock({
  mapping,
  sources,
  targetsByName,
  lookups,
  onLookupsChange,
  compact,
}: {
  mapping: FieldMapping
  sources: SourceNode[]
  targetsByName: Map<string, TargetProperty>
  lookups: MappingLookups
  onLookupsChange: (lookups: MappingLookups) => void
  compact?: boolean
}) {
  const source = sources.find((s) => s.id === mapping.sourceId)
  const sampleKey = normalizeLookupKey(source?.value || source?.label || '')
  const table = lookups[mapping.propertyName] ?? {}
  const keys = new Set<string>(Object.keys(table))
  if (sampleKey) keys.add(sampleKey)
  const keyList = [...keys]
  const target = targetsByName.get(mapping.propertyName)

  return (
    <div className="fm-lookup-block">
      {!compact && (
        <h4>
          {mapping.propertyName}
          {target?.ref ? ` → ${target.ref}` : ''}
        </h4>
      )}
      <div className="fm-lookup-hint">
        Map source strings to seed UIDs
        {target?.dataType === 'List'
          ? ' (comma-separate for multiple)'
          : ''}
        . Host owns Identity search/create.
      </div>
      {keyList.length === 0 ? (
        <div className="fm-lookup-hint">
          No sample value yet — paste a source string key after connecting.
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
                onLookupsChange(
                  setLookupEntry(
                    lookups,
                    mapping.propertyName,
                    key,
                    e.target.value,
                  ),
                )
              }
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ))
      )}
    </div>
  )
}

/**
 * Relation lookup string → uid editor.
 * `section` lists every lookup edge; `row` edits a single property's table.
 */
export function LookupEditor({
  mode,
  mappings,
  sources,
  targets,
  lookups,
  onLookupsChange,
  classNames,
  className,
}: LookupEditorProps) {
  const lookupMappings = useMemo(
    () => mappings.filter((m) => m.resolve === 'lookup'),
    [mappings],
  )

  const targetsByName = useMemo(() => {
    const map = new Map<string, TargetProperty>()
    for (const t of targets) map.set(t.name, t)
    return map
  }, [targets])

  if (lookupMappings.length === 0) return null

  const rootClass = [
    slotClass('lookupEditor', classNames),
    mode === 'row' ? 'fm-lookups--row' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClass}>
      {mode === 'section' && (
        <div className="fm-lookups-title">Relation lookups</div>
      )}
      {lookupMappings.map((mapping) => (
        <LookupBlock
          key={`${mapping.sourceId}-${mapping.propertyName}`}
          mapping={mapping}
          sources={sources}
          targetsByName={targetsByName}
          lookups={lookups}
          onLookupsChange={onLookupsChange}
          compact={mode === 'row'}
        />
      ))}
    </div>
  )
}
