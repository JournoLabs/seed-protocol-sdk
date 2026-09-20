/**
 * React UI entry for `@seedprotocol/mapping/react`.
 * Import FieldMapper from here — not from `@seedprotocol/mapping` — so Node
 * consumers of the headless API never resolve the React peer.
 */
export {
  FieldMapper,
  connectionStrokeForIndex,
  FIELD_MAPPER_PAIR_SLOTS,
  type FieldMapperProps,
  type FieldMapperTheme,
  type FieldMapperLayout,
  type FieldMapperRowKey,
  type FieldMapperDefaultRows,
} from './react/FieldMapper'

export {
  useFieldMapper,
  filterPropertyNames,
} from './react/useFieldMapper'

export type {
  FieldMapperOption,
  FieldMapperRow,
  FieldMapperRowState,
  FieldMapperCoverage,
  UseFieldMapperArgs,
  UseFieldMapperResult,
} from './react/fieldMapperTypes'

export {
  computeRequiredResolve,
  computeCoverage,
  buildSourceOptions,
  buildPropertyModeRows,
  findConflicts,
  connectSourceToProperty,
} from './react/fieldMapperCore'
