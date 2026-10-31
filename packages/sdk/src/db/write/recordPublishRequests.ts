import { BaseDb } from '@/db/Db/BaseDb'
import { updatePublishAttempt } from '@/db/write/publishAttempts'
import { updateVersionUid, type UpdateVersionUidProps } from '@/db/write/updateVersionUid'
import { updateSeedUid, type UpdateSeedUidProps } from '@/db/write/updateSeedUid'
import {
  applyPropertyAttestationUidsFromPublish,
  type ApplyPropertyAttestationUidsParams,
} from '@/db/write/applyPropertyAttestationUidsFromPublish'

/** What one publish request created. */
export type PublishRequestRecord = {
  seed?: UpdateSeedUidProps
  version?: UpdateVersionUidProps
  properties?: ApplyPropertyAttestationUidsParams
}

/**
 * Records what one publish transaction attested, for every request in it, in one database
 * transaction: a reader never sees a version without its properties, and a failure leaves none of
 * it behind. Writing the same records again changes nothing, so a publish can repeat this from its
 * receipt. Seed uids go last: updateSeedUid stamps them on the version and property rows.
 * `attemptId` ends that publish attempt in the same transaction, so it can't stay open after a
 * record, or close without one.
 * @throws when there is no database to record in
 */
export async function recordPublishRequests(
  records: PublishRequestRecord[],
  { attemptId }: { attemptId?: string } = {},
): Promise<void> {
  const toWrite = records.filter((r) => r.seed || r.version || r.properties?.pairs.length)
  if (toWrite.length === 0 && !attemptId) return
  if (!BaseDb.getAppDb()) throw new Error('recordPublishRequests: the database is not ready')
  await BaseDb.transaction(async (tx) => {
    for (const { version, properties } of toWrite) {
      if (version) await updateVersionUid(version, { db: tx })
      if (properties?.pairs.length) await applyPropertyAttestationUidsFromPublish(properties, { db: tx })
    }
    for (const { seed } of toWrite) {
      if (seed) await updateSeedUid(seed, { db: tx })
    }
    if (attemptId) await updatePublishAttempt(attemptId, { status: 'recorded' }, { db: tx })
  })
}
