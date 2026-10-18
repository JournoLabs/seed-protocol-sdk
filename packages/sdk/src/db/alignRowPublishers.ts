import { eq, inArray } from 'drizzle-orm'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { writeInBatches } from '@/db/sqlParamBatches'
import { appState, metadata, seeds, versions } from '@/seedSchema'
import { normalizePublisher } from '@/helpers/addresses'
import { isPlaceholderUid } from '@/helpers/easUid'
import { resolvePublisherFromSeedRow } from '@/helpers/ownership'
import { isLeaderTab, whenLeaderTab, withDbTabLock } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:db:alignRowPublishers')

/** appState key recording that the fix below has run on this database. */
export const ROW_PUBLISHERS_ALIGNED_KEY = 'rowPublishersAligned'

export type AlignRowPublishersResult = {
  versionRows: number
  propertyRows: number
}

type ChildRow = {
  localId: string | null
  uid: string | null
  publisher: string | null
  attestationRaw: string | null
  seedPublisher: string | null
  seedAttestationRaw: string | null
  seedUid: string | null
}

/**
 * Gives version and property rows their seed's publisher. Before, edits wrote property rows with no
 * publisher, and versions and property rows took the session's publisher rather than the seed's,
 * so connecting another wallet could claim rows of a seed that already had one. Local query reads
 * report a row's publisher as its attester and leave out rows whose attester isn't their parent's.
 *
 * Only rows without a stored attestation are changed: synced rows carry their attester in
 * `attestation_raw`. When the seed belongs to no wallet yet, its unsealed rows lose any publisher,
 * so they're claimed with it.
 */
export async function alignRowPublishers(): Promise<AlignRowPublishersResult> {
  const appDb = BaseDb.getAppDb()

  const align = async (table: typeof versions | typeof metadata): Promise<number> => {
    const rows = (await appDb
      .select({
        localId: table.localId,
        uid: table.uid,
        publisher: table.publisher,
        seedPublisher: seeds.publisher,
        seedAttestationRaw: seeds.attestationRaw,
        seedUid: seeds.uid,
        attestationRaw: table.attestationRaw,
      })
      .from(table)
      .innerJoin(seeds, eq(seeds.localId, table.seedLocalId))) as ChildRow[]

    const byTarget = new Map<string | null, string[]>()
    for (const row of rows) {
      if (!row.localId || (row.attestationRaw != null && row.attestationRaw !== '')) continue
      const seedPublisher = normalizePublisher(
        resolvePublisherFromSeedRow({
          publisher: row.seedPublisher,
          attestationRaw: row.seedAttestationRaw,
          uid: row.seedUid,
        }),
      )
      const current = normalizePublisher(row.publisher)
      let target: string | null
      if (seedPublisher) {
        if (current === seedPublisher) continue
        target = seedPublisher
      } else {
        // A seed with no wallet yet: its unsealed rows go with it when it's claimed.
        if (!current || !isPlaceholderUid(row.uid)) continue
        target = null
      }
      const ids = byTarget.get(target) ?? []
      ids.push(row.localId)
      byTarget.set(target, ids)
    }

    let changed = 0
    for (const [target, ids] of byTarget) {
      await writeInBatches(ids, (chunk) =>
        appDb.update(table).set({ publisher: target }).where(inArray(table.localId, chunk)),
      )
      changed += ids.length
    }
    return changed
  }

  const versionRows = await align(versions)
  const propertyRows = await align(metadata)
  return { versionRows, propertyRows }
}

/** Runs the fix unless this database has had it, and records that it has. */
async function runOnce(): Promise<void> {
  const appDb = BaseDb.getAppDb()
  const marker = await appDb
    .select()
    .from(appState)
    .where(eq(appState.key, ROW_PUBLISHERS_ALIGNED_KEY))
    .limit(1)
  if (marker.length > 0) return

  const result = await alignRowPublishers()
  const value = JSON.stringify({ ...result, at: Date.now() })
  await appDb
    .insert(appState)
    .values({ key: ROW_PUBLISHERS_ALIGNED_KEY, value })
    .onConflictDoUpdate({ target: appState.key, set: { value } })
  if (result.versionRows > 0 || result.propertyRows > 0) {
    logger(`gave ${result.versionRows} version and ${result.propertyRows} property rows their seed's publisher`)
  }
}

let running: Promise<void> | undefined
let deferredUntilLeader = false

const runInBackground = (): Promise<void> => {
  // Under the sync's lock: sync writes these rows too.
  running ??= withDbTabLock('eas-sync', runOnce, { timeoutMs: Infinity })
    .catch((error) => {
      // Never fails init: the rows keep their old publisher.
      logger('row publisher fix failed', error)
    })
    .finally(() => {
      running = undefined
    })
  return running
}

/**
 * Starts {@link alignRowPublishers} in the background after client init, once per database, like
 * the foreign-attestation cleanup. Leader tab only (docs/MULTI_TAB.md). Never throws.
 */
export function startAlignRowPublishers(): void {
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
export function whenAlignRowPublishersSettled(): Promise<void> {
  return running ?? Promise.resolve()
}
