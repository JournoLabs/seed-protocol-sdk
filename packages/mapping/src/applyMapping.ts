import { resolveMappingSource } from './resolvedSources'
import type {
  ApplyMappingAsyncResult,
  FieldMapping,
  PropertyBag,
  ResolveCallback,
  ResolveContext,
  SourceNode,
  TargetProperty,
  UrlMediaClass,
} from './types'

/**
 * Coerce a raw string value to the Seed model property dataType.
 */
export function coerceValue(rawValue: string, dataType: string): unknown {
  if (dataType === 'Number') {
    return parseFloat(String(rawValue)) || 0
  }
  if (dataType === 'Boolean') {
    return (
      rawValue === 'true' ||
      rawValue === '1' ||
      String(rawValue).toLowerCase() === 'yes'
    )
  }
  if (dataType === 'Json') {
    try {
      return JSON.parse(rawValue)
    } catch {
      return rawValue
    }
  }
  if (dataType === 'Date') {
    const d = new Date(String(rawValue))
    return Number.isNaN(d.getTime()) ? rawValue : d.getTime()
  }
  return String(rawValue ?? '')
}

function coerceResolved(raw: unknown, dataType: string): unknown {
  if (typeof raw === 'string') {
    return coerceValue(raw, dataType)
  }
  if (raw == null) {
    return coerceValue('', dataType)
  }
  // Host may return seed refs, blobs, or already-shaped values for File/Image.
  if (
    dataType === 'Image' ||
    dataType === 'File' ||
    dataType === 'Relation' ||
    dataType === 'Json'
  ) {
    return raw
  }
  return coerceValue(String(raw), dataType)
}

function urlFromSource(source: SourceNode): string {
  if (typeof source.meta?.url === 'string' && source.meta.url.trim()) {
    return source.meta.url.trim()
  }
  return (source.value || source.label).trim()
}

function contentTypeFromSource(source: SourceNode): string | undefined {
  const ct = source.meta?.contentType ?? source.meta?.type
  return typeof ct === 'string' && ct.trim() ? ct.trim() : undefined
}

function classFromSource(source: SourceNode): UrlMediaClass | undefined {
  const c = source.meta?.class
  if (
    c === 'html' ||
    c === 'image' ||
    c === 'audio' ||
    c === 'video' ||
    c === 'unknown'
  ) {
    return c
  }
  return undefined
}

/**
 * Apply field mappings to produce a property bag for createItem / publish.
 * Missing sources or unknown target properties are skipped (no throw).
 * Mappings with `resolve` are skipped — use `applyMappingAsync` with a host callback.
 */
export function applyMapping(
  sources: SourceNode[],
  mappings: FieldMapping[],
  targets: TargetProperty[],
): PropertyBag {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const byName = new Map(targets.map((t) => [t.name, t]))
  const properties: PropertyBag = {}

  for (const mapping of mappings) {
    if (mapping.resolve) continue

    const source = byId.get(mapping.sourceId)
    const target = byName.get(mapping.propertyName)
    if (!source || !target) continue

    const raw = source.value || source.label
    properties[mapping.propertyName] = coerceValue(raw, target.dataType)
  }

  return properties
}

export type ApplyMappingAsyncOptions = {
  resolve: ResolveCallback
}

/**
 * Async apply: copy+coerce plain edges; for `resolve` edges call the host
 * callback then coerce. Partial success — failed resolve edges are listed in
 * `errors` and omitted from `properties`.
 */
export async function applyMappingAsync(
  sources: SourceNode[],
  mappings: FieldMapping[],
  targets: TargetProperty[],
  options: ApplyMappingAsyncOptions,
): Promise<ApplyMappingAsyncResult> {
  const byName = new Map(targets.map((t) => [t.name, t]))
  const properties: PropertyBag = {}
  const errors: ApplyMappingAsyncResult['errors'] = []

  for (const mapping of mappings) {
    const target = byName.get(mapping.propertyName)
    if (!target) continue

    if (!mapping.resolve) {
      const source = sources.find((s) => s.id === mapping.sourceId)
      if (!source) continue
      const raw = source.value || source.label
      properties[mapping.propertyName] = coerceValue(raw, target.dataType)
      continue
    }

    const source = resolveMappingSource(sources, mapping)
    if (!source) {
      errors.push({
        sourceId: mapping.sourceId,
        propertyName: mapping.propertyName,
        resolve: mapping.resolve,
        message: `Source not found: ${mapping.sourceId}`,
      })
      continue
    }

    const ctx: ResolveContext = {
      job: mapping.resolve,
      url: urlFromSource(source),
      source,
      target,
      contentType: contentTypeFromSource(source),
      class: classFromSource(source),
    }

    try {
      const resolved = await options.resolve(ctx)
      properties[mapping.propertyName] = coerceResolved(resolved, target.dataType)
    } catch (err) {
      errors.push({
        sourceId: mapping.sourceId,
        propertyName: mapping.propertyName,
        resolve: mapping.resolve,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { properties, errors }
}
