import React from 'react'
import type {
  FieldMapping,
  MappingLookups,
  SourceNode,
  TargetProperty,
} from '../types'
import { FieldMapperWires } from './FieldMapperWires'
import type {
  FieldMapperDefaultRows,
  FieldMapperLayout,
  FieldMapperRowKey,
} from './fieldMapperTypes'
import {
  DEFAULT_THEME_CSS,
  type FieldMapperTheme,
} from './fieldMapperTheme'
import { PropertyRows } from './PropertyRows'
import { SourceRows } from './SourceRows'
import { useFieldMapper } from './useFieldMapper'

export {
  connectionStrokeForIndex,
  FIELD_MAPPER_PAIR_SLOTS,
  type FieldMapperTheme,
} from './fieldMapperTheme'

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
   * `default` injects a self-contained dark theme (CSS variables + rules).
   * `unstyled` skips injected paint — host styles structural classes / CSS vars.
   */
  theme?: FieldMapperTheme
  /**
   * Optional connector stroke colors (wires layout). When omitted, strokes use
   * `var(--fm-map-N, var(--map-N, currentColor))` for N = 1…8.
   */
  connectionColors?: string[]
  /** Show JSON preview. Default true. */
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
  showPreview = true,
  layout = 'wires',
  rowKey = 'property',
  defaultRows = 'requiredAndMapped',
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

  const rootClass = [
    'seed-field-mapper',
    theme === 'unstyled' ? 'seed-field-mapper--unstyled' : null,
    layout === 'rows' ? 'seed-field-mapper--rows' : 'seed-field-mapper--wires',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={rootClass}
      data-theme={theme}
      data-layout={layout}
      data-row-key={layout === 'rows' ? rowKey : undefined}
    >
      {theme === 'default' && <style>{DEFAULT_THEME_CSS}</style>}

      {layout === 'wires' ? (
        <FieldMapperWires
          sources={sources}
          targets={targets}
          mappings={mappings}
          mapper={mapper}
          lookups={lookups}
          onLookupsChange={onLookupsChange}
          connectionColors={connectionColors}
          showPreview={showPreview}
        />
      ) : rowKey === 'source' ? (
        <SourceRows mapper={mapper} showPreview={showPreview} />
      ) : (
        <PropertyRows
          sources={sources}
          targets={targets}
          mappings={mappings}
          mapper={mapper}
          defaultRows={defaultRows}
          lookups={lookups}
          onLookupsChange={onLookupsChange}
          showPreview={showPreview}
        />
      )}
    </div>
  )
}

export default FieldMapper
