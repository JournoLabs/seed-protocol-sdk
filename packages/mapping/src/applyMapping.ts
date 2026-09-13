import type {
  FieldMapping,
  PropertyBag,
  SourceNode,
  TargetProperty,
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

/**
 * Apply field mappings to produce a property bag for createItem / publish.
 * Missing sources or unknown target properties are skipped (no throw).
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
    const source = byId.get(mapping.sourceId)
    const target = byName.get(mapping.propertyName)
    if (!source || !target) continue

    const raw = source.value || source.label
    properties[mapping.propertyName] = coerceValue(raw, target.dataType)
  }

  return properties
}
