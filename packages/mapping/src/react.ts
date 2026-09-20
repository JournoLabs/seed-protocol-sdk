/**
 * React UI entry for `@seedprotocol/mapping/react`.
 * Import FieldMapper from here — not from `@seedprotocol/mapping` — so Node
 * consumers of the headless API never resolve the React peer.
 */
export {
  FieldMapper,
  connectionStrokeForIndex,
  FIELD_MAPPER_PAIR_SLOTS,
  resolveTheme,
  ensureThemeInjected,
  buildThemeCss,
  wrapInThemeLayer,
  DEFAULT_THEME_CSS,
  STRUCTURAL_THEME_CSS,
  PAINT_THEME_CSS,
  THEME_STYLE_ID,
  resetThemeInjectionForTests,
  slotClass,
  resolveSlots,
  showRowPreview,
  showJsonPreview,
  SLOT_BASE_CLASS,
  type FieldMapperProps,
  type FieldMapperTheme,
  type ResolvedFieldMapperTheme,
  type FieldMapperLayout,
  type FieldMapperRowKey,
  type FieldMapperDefaultRows,
  type FieldMapperSlot,
  type FieldMapperSlots,
  type ResolvedFieldMapperSlots,
  type FieldMapperComponents,
  type ResolvedFieldMapperComponents,
  type FieldMapperSelectProps,
  type FieldMapperButtonProps,
  type FieldMapperPillProps,
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
  buildSyncPreviewBag,
  previewForEdge,
  findConflicts,
  connectSourceToProperty,
} from './react/fieldMapperCore'
