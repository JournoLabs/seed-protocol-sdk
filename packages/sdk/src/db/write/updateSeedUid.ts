import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { normalizePublisher } from '@/helpers/addresses'
import { isValidEasAttestationUid } from '@seedprotocol/eas'
import { mergeSeedRowInto, otherSeedRowsWithUid } from '@/db/write/mergeChainRows'

type Tx = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

export type UpdateSeedUidProps = {
  seedLocalId: string
  seedUid: string
  publisher?: string
  /** Unix ms when the seed attestation was created (EAS / chain time). */
  attestationCreatedAt?: number
}

/**
 * Updates seedUid and optionally publisher, in one transaction. `publisher` is the address that
 * attested: it replaces the publisher of a row that was an unsealed draft (no uid, no stored
 * attestation), which was only a guess at who would publish, and fills in a blank one. A sealed
 * row's publisher is never changed. A seed row
 * another writer inserted for the same uid (a sync that ran while this was published) is merged
 * into this one first, since seeds.uid is unique.
 * With `db` (a transaction), it writes there instead of in a transaction of its own.
 */
export const updateSeedUid = async (
  { seedLocalId, seedUid, publisher, attestationCreatedAt }: UpdateSeedUidProps,
  { db }: { db?: Tx } = {},
): Promise<void> => {
  if (!seedLocalId || !seedUid) {
    return
  }

  const normalizedPublisher = normalizePublisher(publisher)
  const write = async (tx: Tx) => {
    const [row] = await tx
      .select({ uid: seeds.uid, publisher: seeds.publisher, attestationRaw: seeds.attestationRaw })
      .from(seeds)
      .where(eq(seeds.localId, seedLocalId))
      .limit(1)
    if (!row) return
    for (const duplicate of await otherSeedRowsWithUid(tx, seedUid, seedLocalId)) {
      await mergeSeedRowInto(tx, duplicate, seedLocalId)
    }
    const wasDraft = !isValidEasAttestationUid(row.uid) && !row.attestationRaw
    const shouldSetPublisher =
      normalizedPublisher != null && (wasDraft || row.publisher == null || row.publisher === '')
    // A different uid is a new seed attestation (a republish after unpublish): the revocation and
    // the stored attestation belonged to the old one.
    const replacesSeedAttestation =
      isValidEasAttestationUid(row.uid) && row.uid!.toLowerCase() !== seedUid.toLowerCase()

    await tx
      .update(seeds)
      .set({
        uid: seedUid,
        ...(replacesSeedAttestation && { revokedAt: null, attestationRaw: null }),
        ...(shouldSetPublisher && { publisher: normalizedPublisher }),
        ...(attestationCreatedAt != null && { attestationCreatedAt }),
      })
      .where(eq(seeds.localId, seedLocalId))

    // Attested version and property rows recorded before the seed uid was known (a republish records
    // its new version and property attestations first) belong to this seed attestation.
    if (isValidEasAttestationUid(seedUid)) {
      await tx
        .update(versions)
        .set({ seedUid })
        .where(
          and(eq(versions.seedLocalId, seedLocalId), isNotNull(versions.uid), isNull(versions.seedUid)),
        )
      await tx
        .update(metadata)
        .set({ seedUid })
        .where(
          and(eq(metadata.seedLocalId, seedLocalId), isNotNull(metadata.uid), isNull(metadata.seedUid)),
        )
    }
  }
  if (db) await write(db)
  else await BaseDb.transaction(write)
}
