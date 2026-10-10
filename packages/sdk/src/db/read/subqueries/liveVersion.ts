import { versions } from '@/seedSchema'
import { eq, isNull, or, type SQL } from 'drizzle-orm'

/**
 * True when a version row's attestation was revoked (`versions.revoked_at` set). 0 counts as
 * "not revoked", like `seeds.revoked_at`.
 */
export const isVersionRevoked = (revokedAt: number | null | undefined): boolean =>
  revokedAt != null && revokedAt !== 0

/**
 * SQL filter for version rows that are not revoked. "Latest version" and "latest published
 * version" reads only consider these rows (see docs/ATTESTATION_REVOCATION.md).
 */
export const versionNotRevoked = (): SQL =>
  or(isNull(versions.revokedAt), eq(versions.revokedAt, 0)) as SQL
