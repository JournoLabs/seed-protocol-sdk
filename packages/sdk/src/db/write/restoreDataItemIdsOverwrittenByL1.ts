import { and, eq, isNotNull, isNull, or } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { arweaveL1FinalizeJobs, metadata } from '@/seedSchema'

export type RestoreDataItemIdsResult = {
  /** Rows set back to the data item id they were attested with. */
  restored: number
  /** (seed, version, bundle) groups with several data items: which row was which can't be told. */
  ambiguous: number
}

/**
 * Undo what the bundler L1-finalize worker used to do: once a bundle was confirmed, it replaced
 * the `storage_transaction_id` rows' data item id with the bundle's L1 transaction id. The
 * attestation holds the data item id, and `/raw/<bundle>` returns the whole bundle, so the local
 * value was wrong. The worker no longer does this; this sets rows it changed back, from the
 * confirmed jobs in `arweave_l1_finalize_jobs`.
 *
 * Only when a seed's version has one job in that bundle: with several, the rows all hold the same
 * bundle id and can't be matched to their data items, so they are counted as ambiguous and left.
 */
export async function restoreDataItemIdsOverwrittenByL1(): Promise<RestoreDataItemIdsResult> {
  const appDb = BaseDb.getAppDb()
  const jobs = await appDb
    .select()
    .from(arweaveL1FinalizeJobs)
    .where(and(eq(arweaveL1FinalizeJobs.phase, 'confirmed'), isNotNull(arweaveL1FinalizeJobs.l1TransactionId)))

  const groups = new Map<string, (typeof jobs)[number][]>()
  for (const job of jobs) {
    if (!job.l1TransactionId || job.l1TransactionId === job.dataItemId) continue
    const key = `${job.seedLocalId}|${job.versionLocalId ?? ''}|${job.l1TransactionId}`
    groups.set(key, [...(groups.get(key) ?? []), job])
  }

  let restored = 0
  let ambiguous = 0
  for (const group of groups.values()) {
    const job = group[0]!
    const l1 = job.l1TransactionId!
    const where = and(
      eq(metadata.seedLocalId, job.seedLocalId),
      job.versionLocalId ? eq(metadata.versionLocalId, job.versionLocalId) : isNull(metadata.versionLocalId),
      eq(metadata.propertyValue, l1),
      or(eq(metadata.propertyName, 'storage_transaction_id'), eq(metadata.propertyName, 'storageTransactionId')),
    )
    const rows = await appDb.select().from(metadata).where(where)
    if (rows.length === 0) continue
    if (group.length > 1) {
      ambiguous += 1
      continue
    }
    for (const row of rows) {
      const swap = (value: string | null) => (value ? value.split(l1).join(job.dataItemId) : value)
      await appDb
        .update(metadata)
        .set({
          propertyValue: job.dataItemId,
          refResolvedValue: swap(row.refResolvedValue),
          refResolvedDisplayValue: swap(row.refResolvedDisplayValue),
          updatedAt: Date.now(),
        })
        .where(eq(metadata.localId, row.localId!))
      restored += 1
    }
  }
  return { restored, ambiguous }
}
