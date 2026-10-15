import { and, eq, inArray, isNotNull, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { writeInBatches } from '@/db/sqlParamBatches'
import { appState, metadata, seeds, versions } from '@/seedSchema'
import { isLeaderTab, whenLeaderTab, withDbTabLock } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:db:removeForeignAttestationRows')

/** appState key recording that the cleanup below has run on this database. */
export const FOREIGN_ATTESTATION_CLEANUP_KEY = 'foreignAttestationRowsRemoved'

/** Lowercased `attester` of a stored attestation JSON; NULL when the JSON is invalid or has none. */
const attesterOf = (raw: SQLWrapper): SQL =>
  sql`(CASE WHEN json_valid(${raw}) THEN lower(json_extract(${raw}, '$.attester')) END)`

export type ForeignAttestationCleanupResult = {
  versionRows: number
  propertyRows: number
}

/**
 * Deletes rows that an SDK without the attester check (partitionByRefAttester) synced from other
 * accounts' attestations: versions whose attester isn't their seed's, and
 * properties whose attester isn't their version's, plus the properties of those versions. Sync
 * removes them too, but only for the seeds it reaches, and only online; this needs no network.
 *
 * Only rows synced from EAS on both sides are compared, by the `attester` in their stored
 * attestation, as sync compares them: local drafts and rows without a stored attestation are
 * kept, like partitionByRefAttester keeps children whose attesters aren't both known.
 */
export async function removeForeignAttestationRows(): Promise<ForeignAttestationCleanupResult> {
  const appDb = BaseDb.getAppDb()

  const foreignVersions: { uid: string | null }[] = await appDb
    .select({ uid: versions.uid })
    .from(versions)
    .innerJoin(seeds, eq(seeds.localId, versions.seedLocalId))
    .where(
      and(
        isNotNull(versions.uid),
        sql`${attesterOf(versions.attestationRaw)} <> ${attesterOf(seeds.attestationRaw)}`,
      ),
    )
  const foreignVersionUids = foreignVersions.map((row) => row.uid!).filter(Boolean)

  const foreignProperties: { localId: string | null }[] = await appDb
    .select({ localId: metadata.localId })
    .from(metadata)
    .innerJoin(versions, eq(versions.uid, metadata.versionUid))
    .where(
      and(
        isNotNull(metadata.uid),
        sql`${attesterOf(metadata.attestationRaw)} <> ${attesterOf(versions.attestationRaw)}`,
      ),
    )
  const foreignPropertyLocalIds = foreignProperties.map((row) => row.localId!).filter(Boolean)

  let propertyRows = foreignPropertyLocalIds.length
  await writeInBatches(foreignPropertyLocalIds, (chunk) =>
    appDb.delete(metadata).where(inArray(metadata.localId, chunk)),
  )
  await writeInBatches(foreignVersionUids, async (chunk) => {
    const removed = await appDb
      .delete(metadata)
      .where(inArray(metadata.versionUid, chunk))
      .returning({ localId: metadata.localId })
    propertyRows += removed.length
  })
  await writeInBatches(foreignVersionUids, (chunk) =>
    appDb.delete(versions).where(inArray(versions.uid, chunk)),
  )

  return { versionRows: foreignVersionUids.length, propertyRows }
}

/** Runs the cleanup unless this database has had it, and records that it has. */
async function runOnce(): Promise<void> {
  const appDb = BaseDb.getAppDb()
  const marker = await appDb
    .select()
    .from(appState)
    .where(eq(appState.key, FOREIGN_ATTESTATION_CLEANUP_KEY))
    .limit(1)
  if (marker.length > 0) return

  const result = await removeForeignAttestationRows()
  const value = JSON.stringify({ ...result, at: Date.now() })
  await appDb
    .insert(appState)
    .values({ key: FOREIGN_ATTESTATION_CLEANUP_KEY, value })
    .onConflictDoUpdate({ target: appState.key, set: { value } })
  if (result.versionRows > 0 || result.propertyRows > 0) {
    logger(`removed ${result.versionRows} version and ${result.propertyRows} property rows from other attesters`)
  }
}

let running: Promise<void> | undefined
let deferredUntilLeader = false

const runInBackground = (): Promise<void> => {
  // Under the sync's lock, so it can't interleave with a sync writing the same rows.
  running ??= withDbTabLock('eas-sync', runOnce, { timeoutMs: Infinity })
    .catch((error) => {
      // Never fails init: the rows stay until the next sync of their seeds removes them.
      logger('foreign attestation cleanup failed', error)
    })
    .finally(() => {
      running = undefined
    })
  return running
}

/**
 * Starts {@link removeForeignAttestationRows} in the background after client init, once per
 * database: a one-time data fix, so an init step rather than a SQL migration (it needs the
 * attester out of stored JSON, the same rule as sync, and must never block or fail init). Leader
 * tab only (docs/MULTI_TAB.md); a tab that isn't leader runs it if it takes over. Never throws.
 */
export function startForeignAttestationCleanup(): void {
  if (isLeaderTab()) {
    void runInBackground()
    return
  }
  if (deferredUntilLeader) return
  deferredUntilLeader = true
  void whenLeaderTab().then(() => {
    deferredUntilLeader = false
    void runInBackground()
  })
}

/** Resolves when a background run has finished (at once if none is running). */
export function whenForeignAttestationCleanupSettled(): Promise<void> {
  return running ?? Promise.resolve()
}
