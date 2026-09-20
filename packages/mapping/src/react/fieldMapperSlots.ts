import type { ComponentType, MouseEvent, ReactNode } from 'react'

export type FieldMapperSlot =
  | 'root'
  | 'toolbar'
  | 'filter'
  | 'coverage'
  | 'autoMapButton'
  | 'rowList'
  | 'row'
  | 'propertyLabel'
  | 'dataType'
  | 'sourceSelect'
  | 'transformSelect'
  | 'preview'
  | 'validation'
  | 'removeButton'
  | 'addButton'
  | 'inspector'
  | 'lookupEditor'
  | 'jsonPreview'

export type FieldMapperSlots = {
  autoMap?: boolean
  filter?: boolean
  inspector?: boolean
  preview?: 'row' | 'json' | 'both' | false
  /**
   * Lookup editor placement. `'row'` is accepted but falls back to `'section'`
   * until Phase 4 ships per-row lookup editors.
   */
  lookups?: 'row' | 'section' | false
}

export type ResolvedFieldMapperSlots = {
  autoMap: boolean
  filter: boolean
  inspector: boolean
  preview: 'row' | 'json' | 'both' | false
  /** Always `'section' | false` after Phase 3 resolution. */
  lookups: 'section' | false
}

export type FieldMapperSelectProps = {
  className?: string
  value: string
  onChange: (value: string) => void
  'aria-label'?: string
  children: ReactNode
  disabled?: boolean
}

export type FieldMapperButtonProps = {
  className?: string
  type?: 'button' | 'submit' | 'reset'
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
  disabled?: boolean
  'aria-label'?: string
  'aria-pressed'?: boolean | 'true' | 'false'
}

export type FieldMapperPillProps = {
  children: ReactNode
  className?: string
}

export type FieldMapperComponents = {
  Select?: ComponentType<FieldMapperSelectProps>
  Button?: ComponentType<FieldMapperButtonProps>
  Pill?: ComponentType<FieldMapperPillProps>
}

export type ResolvedFieldMapperComponents = {
  Select: ComponentType<FieldMapperSelectProps>
  Button: ComponentType<FieldMapperButtonProps>
  Pill: ComponentType<FieldMapperPillProps>
}

/** Package class names per slot (merged with host `classNames`). */
export const SLOT_BASE_CLASS: Record<FieldMapperSlot, string> = {
  root: 'seed-field-mapper',
  toolbar: 'fm-toolbar',
  filter: 'fm-filter',
  coverage: 'fm-meta',
  autoMapButton: 'fm-btn fm-btn-primary',
  rowList: 'fm-row-list',
  row: 'fm-row',
  propertyLabel: 'fm-row-prop-name',
  dataType: 'fm-dtype',
  sourceSelect: 'fm-select',
  transformSelect: 'fm-select',
  preview: 'fm-row-preview',
  validation: 'fm-row-flag',
  removeButton: 'fm-remove',
  addButton: 'fm-btn',
  inspector: 'fm-inspector',
  lookupEditor: 'fm-lookups',
  jsonPreview: 'fm-preview',
}

/** Merge package slot class with optional host classNames entry. */
export function slotClass(
  slot: FieldMapperSlot,
  classNames?: Partial<Record<FieldMapperSlot, string>>,
  extra?: string | null,
): string {
  return [SLOT_BASE_CLASS[slot], classNames?.[slot], extra]
    .filter(Boolean)
    .join(' ')
}

/**
 * Resolve slots + deprecated `showPreview` shim.
 * Default preview is `'both'` (row preview + JSON toggle) when unspecified.
 */
export function resolveSlots(
  slots?: FieldMapperSlots,
  showPreview?: boolean,
): ResolvedFieldMapperSlots {
  let preview: ResolvedFieldMapperSlots['preview']
  if (slots?.preview !== undefined) {
    preview = slots.preview
  } else if (showPreview === false) {
    preview = false
  } else {
    preview = 'both'
  }

  let lookups: ResolvedFieldMapperSlots['lookups']
  if (slots?.lookups === false) {
    lookups = false
  } else {
    // `'row'` and `'section'` both resolve to section until Phase 4.
    lookups = 'section'
  }

  return {
    autoMap: slots?.autoMap ?? true,
    filter: slots?.filter ?? true,
    inspector: slots?.inspector ?? true,
    preview,
    lookups,
  }
}

export function showRowPreview(
  preview: ResolvedFieldMapperSlots['preview'],
): boolean {
  return preview === 'row' || preview === 'both'
}

export function showJsonPreview(
  preview: ResolvedFieldMapperSlots['preview'],
): boolean {
  return preview === 'json' || preview === 'both'
}
