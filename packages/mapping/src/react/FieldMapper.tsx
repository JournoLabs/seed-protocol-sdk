import React, { useEffect, useMemo } from 'react'
import type {
  FieldMapping,
  MappingLookups,
  SourceNode,
  TargetProperty,
} from '../types'
import {
  DefaultButton,
  DefaultPill,
  DefaultSelect,
} from './fieldMapperControls'
import type {
  FieldMapperComponents,
  FieldMapperSlot,
  FieldMapperSlots,
} from './fieldMapperSlots'
import { resolveSlots, slotClass } from './fieldMapperSlots'
import { FieldMapperWires } from './FieldMapperWires'
import type {
  FieldMapperDefaultRows,
  FieldMapperLayout,
  FieldMapperRowKey,
} from './fieldMapperTypes'
import {
  ensureThemeInjected,
  resolveTheme,
  type FieldMapperTheme,
} from './fieldMapperTheme'
import { PropertyRows } from './PropertyRows'
import { SourceRows } from './SourceRows'
import { useFieldMapper } from './useFieldMapper'

export {
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
  type FieldMapperTheme,
  type ResolvedFieldMapperTheme,
} from './fieldMapperTheme'

export {
  slotClass,
  resolveSlots,
  showRowPreview,
  showJsonPreview,
  SLOT_BASE_CLASS,
  type FieldMapperSlot,
  type FieldMapperSlots,
  type ResolvedFieldMapperSlots,
  type FieldMapperComponents,
  type ResolvedFieldMapperComponents,
  type FieldMapperSelectProps,
  type FieldMapperButtonProps,
  type FieldMapperPillProps,
} from './fieldMapperSlots'

export type { FieldMapperLayout, FieldMapperRowKey, FieldMapperDefaultRows }

export type FieldMapperProps = {
  /**
   * Source nodes to display. For `layout="wires"`, pass
   * `buildResolvedSourceNodes(sources)` to show extract/file candidates.
   * For `layout="rows"`, pass origin sources — transforms are chosen per row.
   */
  sources: SourceNode[]
  targets: TargetProperty[]
  mappings: FieldMapping[]
  onChange: (mappings: FieldMapping[]) => void
  /**
   * String → seed uid dictionaries for `resolve: 'lookup'` edges.
   * Host should persist alongside `MappingDocument.lookups`.
   */
  lookups?: MappingLookups
  onLookupsChange?: (lookups: MappingLookups) => void
  /** Override default autoMap heuristics. */
  onAutoMap?: () => FieldMapping[]
  className?: string
  /**
   * `default` injects structural + paint CSS.
   * `structural` injects layout/spacing only.
   * `none` skips injection (host styles structural classes / CSS vars).
   * `@deprecated` Prefer `none` — `unstyled` is a shim for `none`.
   */
  theme?: FieldMapperTheme
  /**
   * Optional connector stroke colors (wires layout). When omitted, strokes use
   * `var(--fm-map-N, var(--map-N, currentColor))` for N = 1…8.
   * @deprecated Prefer CSS `--sfm-map-*` / `--fm-map-*` / `--map-*` tokens.
   */
  connectionColors?: string[]
  /**
   * Show JSON preview. Default true.
   * @deprecated Prefer `slots.preview` (`'row' | 'json' | 'both' | false`).
   */
  showPreview?: boolean
  /**
   * Authoring surface. Defaults to `'wires'` for one minor; pass `'rows'` for
   * the row-based redesign.
   */
  layout?: FieldMapperLayout
  /**
   * Which side opens each row when `layout="rows"`.
   * `'property'` (default) cannot represent an invalid state;
   * `'source'` matches the edge list and surfaces conflicts + coverage banners.
   */
  rowKey?: FieldMapperRowKey
  /** Rows shown before the filter is widened (property mode). */
  defaultRows?: FieldMapperDefaultRows
  /** Per-slot class injection; merged with package classes, never replacing them. */
  classNames?: Partial<Record<FieldMapperSlot, string>>
  /** Host design-system controls. Defaults are dependency-free natives. */
  components?: FieldMapperComponents
  /** Include / exclude structural pieces. Replaces `showPreview`. */
  slots?: FieldMapperSlots
}

/**
 * Generic field mapper. Props-driven; no Seed hooks or routing.
 * Default layout is wires; pass `layout="rows"` for the row-based UI.
 */
export function FieldMapper({
  sources,
  targets,
  mappings,
  onChange,
  lookups = {},
  onLookupsChange,
  onAutoMap,
  className,
  theme = 'default',
  connectionColors,
  showPreview,
  layout = 'wires',
  rowKey = 'property',
  defaultRows = 'requiredAndMapped',
  classNames,
  components,
  slots,
}: FieldMapperProps) {
  const mapper = useFieldMapper({
    sources,
    targets,
    mappings,
    onChange,
    lookups,
    onLookupsChange,
    rowKey: layout === 'rows' ? rowKey : 'property',
    onAutoMap,
  })

  const resolvedTheme = resolveTheme(theme)
  const resolvedSlots = useMemo(
    () => resolveSlots(slots, showPreview, { layout }),
    [slots, showPreview, layout],
  )

  const ui = useMemo(
    () => ({
      Select: components?.Select ?? DefaultSelect,
      Button: components?.Button ?? DefaultButton,
      Pill: components?.Pill ?? DefaultPill,
    }),
    [components],
  )

  useEffect(() => {
    ensureThemeInjected(resolvedTheme)
  }, [resolvedTheme])

  const unstyled =
    resolvedTheme === 'none' || theme === 'unstyled' || theme === 'none'

  const rootClass = slotClass(
    'root',
    classNames,
    [
      unstyled ? 'seed-field-mapper--unstyled' : null,
      layout === 'rows' ? 'seed-field-mapper--rows' : 'seed-field-mapper--wires',
      className,
    ]
      .filter(Boolean)
      .join(' ') || null,
  )

  return (
    <div
      className={rootClass}
      data-theme={resolvedTheme}
      data-layout={layout}
      data-row-key={layout === 'rows' ? rowKey : undefined}
    >
      {layout === 'wires' ? (
        <FieldMapperWires
          sources={sources}
          targets={targets}
          mappings={mappings}
          mapper={mapper}
          lookups={lookups}
          onLookupsChange={onLookupsChange}
          connectionColors={connectionColors}
          slots={resolvedSlots}
          classNames={classNames}
          ui={ui}
        />
      ) : rowKey === 'source' ? (
        <SourceRows
          sources={sources}
          targets={targets}
          mappings={mappings}
          mapper={mapper}
          lookups={lookups}
          onLookupsChange={onLookupsChange}
          slots={resolvedSlots}
          classNames={classNames}
          ui={ui}
        />
      ) : (
        <PropertyRows
          sources={sources}
          targets={targets}
          mappings={mappings}
          mapper={mapper}
          defaultRows={defaultRows}
          lookups={lookups}
          onLookupsChange={onLookupsChange}
          slots={resolvedSlots}
          classNames={classNames}
          ui={ui}
        />
      )}
    </div>
  )
}

export default FieldMapper
