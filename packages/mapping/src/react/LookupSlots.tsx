import React, { type ReactNode } from 'react'
import type { FieldMapping, SourceNode, TargetProperty } from '../types'
import type { FieldMapperSlot } from './fieldMapperSlots'
import { slotClass } from './fieldMapperSlots'
import type { FieldMapperLookupRow, FieldMapperRow, UseFieldMapperResult } from './fieldMapperTypes'
import { LookupEditor } from './LookupEditor'

type LookupSlotProps = {
  sources: SourceNode[]
  targets: TargetProperty[]
  mapper: UseFieldMapperResult
  renderLookup?: (row: FieldMapperLookupRow) => ReactNode
  classNames?: Partial<Record<FieldMapperSlot, string>>
}

/** What `renderLookup` gets for a row: the row and the two setters bound to it. */
function lookupRow(row: FieldMapperRow, mapper: UseFieldMapperResult): FieldMapperLookupRow {
  return {
    ...row,
    sampleValue: row.sampleValue ?? '',
    onLookupChange: (entries) => mapper.setLookupEntries(row.id, entries),
    onSplitChange: (separators) => mapper.setLookupSplit(row.id, separators),
  }
}

/** `slots.lookups: 'row'`: one row's editor, the host's `renderLookup` or the package's. */
export function RowLookup({ row, ...props }: LookupSlotProps & { row: FieldMapperRow }) {
  if (row.mapping?.resolve !== 'lookup') return null
  const { mapper, renderLookup, classNames } = props
  if (renderLookup) {
    return <div className={slotClass('lookupEditor', classNames)}>{renderLookup(lookupRow(row, mapper))}</div>
  }
  return (
    <LookupEditor
      mode="row"
      mappings={[row.mapping]}
      sources={props.sources}
      targets={props.targets}
      onLookupChange={(_mapping, entries) => mapper.setLookupEntries(row.id, entries)}
      classNames={classNames}
    />
  )
}

/**
 * `slots.lookups: 'section'`: an editor per lookup row after the rows, from `renderLookup`, or the
 * package's editor for every lookup edge.
 */
export function SectionLookups({ mappings, ...props }: LookupSlotProps & { mappings: FieldMapping[] }) {
  const { mapper, renderLookup, classNames } = props
  if (renderLookup) {
    return (
      <>
        {mapper.rows
          .filter((row) => row.mapping?.resolve === 'lookup')
          .map((row) => (
            <div key={row.id} className={slotClass('lookupEditor', classNames)}>
              {renderLookup(lookupRow(row, mapper))}
            </div>
          ))}
      </>
    )
  }
  return (
    <LookupEditor
      mode="section"
      mappings={mappings}
      sources={props.sources}
      targets={props.targets}
      onLookupChange={(mapping, entries) => {
        const row = mapper.rows.find(
          (r) => r.mapping?.sourceId === mapping.sourceId && r.mapping?.propertyName === mapping.propertyName,
        )
        if (row) mapper.setLookupEntries(row.id, entries)
      }}
      classNames={classNames}
    />
  )
}
