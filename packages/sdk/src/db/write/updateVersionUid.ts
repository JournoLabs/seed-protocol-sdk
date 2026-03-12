import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { eq, desc } from 'drizzle-orm'

type UpdateVersionUidProps = {
  seedLocalId: string
  versionUid: string
  publisher?: string
}

const isEmptyUid = (uid: string | null | undefined): boolean =>
  uid == null || uid === '' || uid === 'NULL'

/**
 * Updates the version record with the attestation UID after a Version attestation is created.
 * Targets the version without a uid yet (the one being published).
 * Publisher is immutable once set: we never overwrite an existing publisher.
 */
export const updateVersionUid = async ({
  seedLocalId,
  versionUid,
  publisher,
}: UpdateVersionUidProps): Promise<void> => {
  if (!seedLocalId || !versionUid) {
    return
  }

  const appDb = BaseDb.getAppDb()
  if (!appDb) return

  const rows = await appDb
    .select({ localId: versions.localId, uid: versions.uid, publisher: versions.publisher })
    .from(versions)
    .where(eq(versions.seedLocalId, seedLocalId))
    .orderBy(desc(versions.createdAt))

  const toUpdate = rows.find((r: { localId: string | null; uid: string | null }) => r.localId && isEmptyUid(r.uid))
  if (!toUpdate?.localId) return

  let shouldSetPublisher = publisher != null && publisher !== ''
  if (shouldSetPublisher && toUpdate.publisher != null && toUpdate.publisher !== '') {
    shouldSetPublisher = false
  }

  await appDb
    .update(versions)
    .set({
      uid: versionUid,
      ...(shouldSetPublisher && { publisher }),
      updatedAt: Date.now(),
    })
    .where(eq(versions.localId, toUpdate.localId))
}
