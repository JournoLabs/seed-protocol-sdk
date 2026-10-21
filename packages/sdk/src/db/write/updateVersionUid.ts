import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { generateId } from '@/helpers'
import { isPlaceholderUid } from '@seedprotocol/eas'
import { normalizePublisher } from '@/helpers/addresses'
import { latestVersionOrder } from '@/db/read/subqueries/latestVersion'
import { mergeVersionRowInto, otherVersionRowsWithUid } from '@/db/write/mergeChainRows'

type UpdateVersionUidProps = {
  seedLocalId: string
  versionUid: string
  publisher?: string
  /** Unix ms when the version attestation was created (EAS / chain time). */
  attestationCreatedAt?: number
}

/**
 * Updates the version record with the attestation UID after a Version attestation is created, in
 * one transaction. Targets the first version without a uid yet in head-version order (the one
 * being published). A uid one of the seed's version rows already has is ignored. A version row
 * another writer inserted for the same uid (a sync that ran during the publish) is merged into the
 * target first, since versions.uid is unique.
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

  if (!BaseDb.getAppDb()) return
  const normalizedPublisher = normalizePublisher(publisher)

  await BaseDb.transaction(async (tx) => {
    const rows = await tx
      .select({ localId: versions.localId, uid: versions.uid, publisher: versions.publisher })
      .from(versions)
      .where(eq(versions.seedLocalId, seedLocalId))
      .orderBy(latestVersionOrder())

    // Already recorded: nothing to stamp. A patch publish attaches to an existing version, and the
    // modular executor's SeedPublished event still reports that version's uid; stamping it onto a
    // local draft version would give two rows the same version uid.
    const wanted = versionUid.toLowerCase()
    if (rows.some((r: { uid: string | null }) => r.uid?.toLowerCase() === wanted)) return

    const toUpdate = rows.find(
      (r: { localId: string | null; uid: string | null }) => r.localId && isPlaceholderUid(r.uid),
    )
    if (!toUpdate?.localId) {
      // No local draft version took this attestation (e.g. a republish after unpublish, where every
      // version row is a revoked attestation): record the new version so it is the latest one. A row
      // another writer already stored for this uid stays (DO NOTHING).
      const [seed] = await tx
        .select({ type: seeds.type })
        .from(seeds)
        .where(eq(seeds.localId, seedLocalId))
        .limit(1)
      if (!seed) return
      await tx
        .insert(versions)
        .values({
          localId: generateId(),
          seedLocalId,
          seedType: seed.type,
          uid: versionUid,
          ...(normalizedPublisher && { publisher: normalizedPublisher }),
          ...(attestationCreatedAt != null && { attestationCreatedAt }),
        })
        .onConflictDoNothing()
      return
    }

    for (const duplicate of await otherVersionRowsWithUid(tx, versionUid, toUpdate.localId)) {
      await mergeVersionRowInto(tx, duplicate, toUpdate.localId)
    }

    const shouldSetPublisher =
      normalizedPublisher != null && (toUpdate.publisher == null || toUpdate.publisher === '')

    await tx
      .update(versions)
      .set({
        uid: versionUid,
        ...(shouldSetPublisher && { publisher: normalizedPublisher }),
        ...(attestationCreatedAt != null && { attestationCreatedAt }),
      })
      .where(eq(versions.localId, toUpdate.localId))
  })
}
