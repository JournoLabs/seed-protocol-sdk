import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { eq, desc } from 'drizzle-orm'
import { generateId } from '@/helpers'
import { isPlaceholderUid } from '@/helpers/easUid'
import { normalizePublisher } from '@/helpers/addresses'

type UpdateVersionUidProps = {
  seedLocalId: string
  versionUid: string
  publisher?: string
  /** Unix ms when the version attestation was created (EAS / chain time). */
  attestationCreatedAt?: number
}

/**
 * Updates the version record with the attestation UID after a Version attestation is created.
 * Targets the version without a uid yet (the one being published).
 * Publisher is immutable once set: we never overwrite an existing publisher.
 */
export const updateVersionUid = async ({
  seedLocalId,
  versionUid,
  publisher,
  attestationCreatedAt,
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

  const toUpdate = rows.find(
    (r: { localId: string | null; uid: string | null }) => r.localId && isPlaceholderUid(r.uid),
  )
  const normalizedPublisher = normalizePublisher(publisher)
  if (!toUpdate?.localId) {
    // No local draft version took this attestation (e.g. a republish after unpublish, where every
    // version row is a revoked attestation): record the new version so it is the latest one.
    if (rows.some((r: { uid: string | null }) => r.uid === versionUid)) return
    const [seed] = await appDb
      .select({ type: seeds.type })
      .from(seeds)
      .where(eq(seeds.localId, seedLocalId))
      .limit(1)
    if (!seed) return
    const now = Date.now()
    await appDb.insert(versions).values({
      localId: generateId(),
      seedLocalId,
      seedType: seed.type,
      uid: versionUid,
      createdAt: now,
      updatedAt: now,
      ...(normalizedPublisher && { publisher: normalizedPublisher }),
      ...(attestationCreatedAt != null && { attestationCreatedAt }),
    })
    return
  }

  let shouldSetPublisher = normalizedPublisher != null
  if (shouldSetPublisher && toUpdate.publisher != null && toUpdate.publisher !== '') {
    shouldSetPublisher = false
  }

  await appDb
    .update(versions)
    .set({
      uid: versionUid,
      ...(shouldSetPublisher && { publisher: normalizedPublisher }),
      ...(attestationCreatedAt != null && { attestationCreatedAt }),
      updatedAt: Date.now(),
    })
    .where(eq(versions.localId, toUpdate.localId))
}
