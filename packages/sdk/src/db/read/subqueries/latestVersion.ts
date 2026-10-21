import { sql, type SQL } from 'drizzle-orm'

/**
 * The order that picks a seed's head version: newest first by attestation time, or by local
 * creation time for a version that has no attestation yet (ADR 0006: latest = highest
 * `timeCreated`), then `local_id DESC` so versions that tie still give one answer. Sync inserts a
 * batch of versions with one `created_at`, so ordering by `created_at` alone leaves them tied.
 *
 * Every reader that picks a head version, attested or not, orders by this. Unqualified column
 * names: use it in queries that read `versions` alone.
 */
export const LATEST_VERSION_ORDER_SQL =
  'COALESCE(attestation_created_at, created_at) DESC, local_id DESC'

/** {@link LATEST_VERSION_ORDER_SQL} for a Drizzle `orderBy`. */
export const latestVersionOrder = (): SQL => sql.raw(LATEST_VERSION_ORDER_SQL)
