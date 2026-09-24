import { stripLookup } from './relationLookup'
import type { AssembleSpec, DeriveSpec, FieldMapping, ResolveJob } from './types'

/** True when the edge covers a property for coverage / row presence. */
export function isPresentEdge(mapping: FieldMapping): boolean {
  if (!mapping.propertyName) return false
  if (mapping.sourceId) return true
  return mapping.resolve === 'derive'
}

/** Drop empty `sourceId` so derive-only edges do not persist `''`. */
export function omitEmptySourceId(edge: FieldMapping): FieldMapping {
  if (edge.sourceId) return edge
  const { sourceId: _sourceId, ...rest } = edge
  return rest
}

export function isDeriveKeepOnClear(prev: FieldMapping): boolean {
  return prev.resolve === 'derive' || Boolean(prev.derive)
}

/** Source-less derive edge after the origin is cleared. */
export function clearSourceKeepDerive(prev: FieldMapping): FieldMapping {
  return omitEmptySourceId({
    propertyName: prev.propertyName,
    resolve: 'derive',
    ...(prev.derive ? { derive: prev.derive } : {}),
  })
}

export function withDeriveSpec(
  edge: FieldMapping,
  spec: DeriveSpec | null,
): FieldMapping {
  if (!spec) {
    if (!edge.derive) return omitEmptySourceId(edge)
    const { derive: _derive, ...rest } = edge
    return omitEmptySourceId(rest)
  }
  return omitEmptySourceId({ ...edge, derive: spec })
}

export function withAssembleBlocks(
  edge: FieldMapping,
  blocks: string[],
): FieldMapping {
  return omitEmptySourceId({ ...edge, assemble: { blocks } })
}

/**
 * Next edge after a transform change.
 * Copy keeps `derive` (fallback). Assemble keeps `assemble`. Lookup keeps `lookup`.
 */
export function applyResolveToEdge(
  prev: FieldMapping,
  nextResolve: ResolveJob | null,
): FieldMapping {
  const base: FieldMapping = {
    propertyName: prev.propertyName,
    ...(prev.sourceId ? { sourceId: prev.sourceId } : {}),
  }

  if (!nextResolve) {
    if (!prev.sourceId && isDeriveKeepOnClear(prev)) {
      return clearSourceKeepDerive(prev)
    }
    if (prev.derive) base.derive = prev.derive
    return omitEmptySourceId(base)
  }

  if (nextResolve === 'derive') {
    return omitEmptySourceId({
      ...base,
      resolve: 'derive',
      ...(prev.derive ? { derive: prev.derive } : {}),
    })
  }

  if (nextResolve === 'assemble') {
    return omitEmptySourceId({
      ...base,
      resolve: 'assemble',
      ...(prev.assemble ? { assemble: prev.assemble } : {}),
    })
  }

  if (nextResolve === 'lookup') {
    return omitEmptySourceId({
      ...base,
      resolve: 'lookup',
      ...(prev.lookup ? { lookup: prev.lookup } : {}),
    })
  }

  return omitEmptySourceId({ ...base, resolve: nextResolve })
}

/**
 * Copy prior `derive` / `assemble` onto a newly connected origin
 * when the next edge did not already set a conflicting job.
 */
export function withPreservedExtras(
  next: FieldMapping,
  prev: FieldMapping | undefined,
): FieldMapping {
  if (!prev) return omitEmptySourceId(stripLookupUnlessLookup(next))
  let out: FieldMapping = { ...next }

  if (!out.resolve) {
    if (prev.resolve === 'assemble') {
      out = {
        ...out,
        resolve: 'assemble',
        ...(prev.assemble ? { assemble: prev.assemble } : {}),
      }
    } else if (prev.resolve === 'derive') {
      out = { ...out, resolve: 'derive' }
    }
  }

  if (prev.derive && (!out.resolve || out.resolve === 'derive')) {
    out = { ...out, derive: out.derive ?? prev.derive }
  }

  if (out.resolve === 'assemble' && prev.assemble && !out.assemble) {
    out = { ...out, assemble: prev.assemble }
  }

  return omitEmptySourceId(stripLookupUnlessLookup(out))
}

function stripLookupUnlessLookup(edge: FieldMapping): FieldMapping {
  return edge.resolve === 'lookup' ? edge : stripLookup(edge)
}
