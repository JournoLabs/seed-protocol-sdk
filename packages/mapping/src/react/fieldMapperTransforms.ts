import type { FieldMapperRow, FieldMapperTransformOption } from './fieldMapperTypes'

export function defaultTransformOptions(
  row: FieldMapperRow,
): FieldMapperTransformOption[] {
  const options: FieldMapperTransformOption[] = [
    { value: '', label: 'copy' },
    { value: 'extract', label: 'extract' },
    { value: 'file', label: 'file' },
    { value: 'lookup', label: 'lookup' },
  ]
  if (row.target?.dataType === 'Html') {
    options.push({ value: 'assemble', label: 'assemble' })
  }
  const current = row.mapping?.resolve
  if (current && !options.some((opt) => opt.value === current)) {
    options.push({ value: current, label: current })
  }
  return options
}

export function resolveTransformOptions(
  row: FieldMapperRow,
  host?: (
    row: FieldMapperRow,
    defaults: FieldMapperTransformOption[],
  ) => FieldMapperTransformOption[],
): FieldMapperTransformOption[] {
  const defaults = defaultTransformOptions(row)
  return host ? host(row, defaults) : defaults
}

/** Show the transform select for a mapped origin, source-less derive, or host derive option. */
export function showTransformSelect(
  row: FieldMapperRow,
  options: FieldMapperTransformOption[],
): boolean {
  if (row.mapping?.sourceId) return true
  if (row.mapping?.resolve === 'derive') return true
  return options.some((opt) => opt.value === 'derive')
}

export function isTransformSelectDisabled(row: FieldMapperRow): boolean {
  return !row.mapping?.sourceId && row.mapping?.resolve === 'derive'
}
