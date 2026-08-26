/**
 * Merges `revoked: { equals: false }` into an EAS AttestationWhereInput
 * so revoked attestations are excluded from discovery/feed queries.
 *
 * Uses AND to combine with existing conditions without overwriting them.
 */
export function withExcludeRevokedFilter<T extends Record<string, unknown>>(
  where: T,
): T & { AND?: unknown[] } {
  const revokedFilter = { revoked: { equals: false } }
  const existingAnd = Array.isArray(where.AND) ? where.AND : []
  return {
    ...where,
    AND: [...existingAnd, revokedFilter],
  } as T & { AND: unknown[] }
}
