import React, { useMemo } from 'react'
import { lookupEntriesFromMapping, lookupKey, lookupValuesFromSource, normalizeLookupKey } from '../relationLookup'
import type {
  FieldMapping,
  LookupEntry,
  SourceNode,
  TargetProperty,
} from '../types'
import type { FieldMapperSlot } from './fieldMapperSlots'
import { slotClass } from './fieldMapperSlots'

/** Refs typed into the fallback input, separated by commas or spaces (refs are ids without either). */
function parseRefsInput(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean)
}

function upsertEntry(
  entries: LookupEntry[],
  value: string,
  refsText: string,
): LookupEntry[] {
  const key = lookupKey(value)
  const refs = parseRefsInput(refsText)
  const next = entries.filter((e) => lookupKey(e.value) !== key)
  if (refs.length === 0) return next
  next.push({ value: normalizeLookupKey(value), refs })
  return next
}

export type LookupEditorProps = {
  mode: 'section' | 'row'
  /** Lookup edges to edit. Section: all lookup mappings; row: one property. */
  mappings: FieldMapping[]
  sources: SourceNode[]
  targets: TargetProperty[]
  onLookupChange: (mapping: FieldMapping, entries: LookupEntry[]) => void
  classNames?: Partial<Record<FieldMapperSlot, string>>
  /** Extra class on the root (e.g. nested-in-row modifier). */
  className?: string
}

function LookupBlock({
  mapping,
  sources,
  targetsByName,
  onLookupChange,
  compact,
}: {
  mapping: FieldMapping
  sources: SourceNode[]
  targetsByName: Map<string, TargetProperty>
  onLookupChange: (mapping: FieldMapping, entries: LookupEntry[]) => void
  compact?: boolean
}) {
  const source = sources.find((s) => s.id === mapping.sourceId)
  const entries = lookupEntriesFromMapping(mapping)
  // One row per lookupKey, shown as its entry spells it (else as the source does)
  const shownByKey = new Map<string, string>()
  for (const e of entries) {
    const shown = normalizeLookupKey(e.value)
    if (shown && !shownByKey.has(lookupKey(shown))) shownByKey.set(lookupKey(shown), shown)
  }
  for (const value of lookupValuesFromSource(source)) {
    if (!shownByKey.has(lookupKey(value))) shownByKey.set(lookupKey(value), value)
  }
  const keyList = [...shownByKey.values()]
  const target = targetsByName.get(mapping.propertyName)
  const refsByKey = new Map(entries.map((e) => [lookupKey(e.value), e.refs.join(', ')]))

  return (
    <div className="fm-lookup-block">
      {!compact && (
        <h4>
          {mapping.propertyName}
          {target?.ref ? ` → ${target.ref}` : ''}
        </h4>
      )}
      <div className="fm-lookup-hint">
        Map source strings to refs, comma-separated for several. Host owns Identity search/create.
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
              placeholder="ref, ref"
              value={refsByKey.get(lookupKey(key)) ?? ''}
              onChange={(e) =>
                onLookupChange(mapping, upsertEntry(entries, key, e.target.value))
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
 * Fallback string → ref editor when the host does not pass `renderLookup`.
 * Writes `FieldMapping.lookup.entries` via `onLookupChange`.
 */
export function LookupEditor({
  mode,
  mappings,
  sources,
  targets,
  onLookupChange,
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
          onLookupChange={onLookupChange}
          compact={mode === 'row'}
        />
      ))}
    </div>
  )
}
