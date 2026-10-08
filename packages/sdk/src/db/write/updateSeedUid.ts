import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { normalizePublisher } from '@/helpers/addresses'
import { isValidEasAttestationUid } from '@/helpers/easUid'

type UpdateSeedUidProps = {
  seedLocalId: string
  seedUid: string
  publisher?: string
  /** Unix ms when the seed attestation was created (EAS / chain time). */
  attestationCreatedAt?: number
}

/**
 * Updates seedUid and optionally publisher. Publisher is immutable once set:
 * we never overwrite an existing publisher (set at creation or from attestation).
 */
export const updateSeedUid = async ({
  seedLocalId,
  seedUid,
  publisher,
  attestationCreatedAt,
}: UpdateSeedUidProps): Promise<void> => {
  if (!seedLocalId || !seedUid) {
    return
  }

  const appDb = BaseDb.getAppDb()

  const normalizedPublisher = normalizePublisher(publisher)
  const [row] = await appDb
    .select({ uid: seeds.uid, publisher: seeds.publisher })
    .from(seeds)
    .where(eq(seeds.localId, seedLocalId))
    .limit(1)
  const shouldSetPublisher =
    normalizedPublisher != null && (row?.publisher == null || row.publisher === '')
  // A different uid is a new seed attestation (a republish after unpublish): the revocation and
  // the stored attestation belonged to the old one.
  const replacesSeedAttestation =
    isValidEasAttestationUid(row?.uid) && row!.uid!.toLowerCase() !== seedUid.toLowerCase()

  await appDb
    .update(seeds)
    .set({
      uid: seedUid,
      ...(replacesSeedAttestation && { revokedAt: null, attestationRaw: null }),
      ...(shouldSetPublisher && { publisher: normalizedPublisher }),
      ...(attestationCreatedAt != null && { attestationCreatedAt }),
      updatedAt: Date.now(),
    })
    .where(eq(seeds.localId, seedLocalId))
}
