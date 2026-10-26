import { BaseDb } from '@/db/Db/BaseDb'
import { placeholderUidSql, publisherIsInOwnedSet, resolvePublisherFromSeedRow } from '@/helpers/ownership'
import {
  arweaveL1FinalizeJobs,
  htmlEmbeddedImageCoPublish,
  metadata,
  pendingWrites,
  publishProcesses,
  seeds,
  versions,
} from '@/seedSchema'
import { and, eq, inArray, isNotNull, ne, or } from 'drizzle-orm'

export type RemoveLocalCopiesResult = {
  removedSeedLocalIds: string[]
  removedSeedUids: string[]
  /**
   * Copies kept because they hold work not on chain (a pending outbox op or an unpublished edit)
   * and their publisher is still an owned address (decision D24). Empty with `includeUnpublished`.
   */
  keptSeedLocalIds: string[]
}

export type RemoveLocalCopiesOptions = {
  /** Also remove copies holding unpublished edits or pending outbox ops of owned addresses. */
  includeUnpublished?: boolean
}

/** Row shape from the candidate select; explicit because `getAppDb()` is typed as `any`. */
type CandidateSeedRow = {
  localId: string | null
  uid: string | null
  publisher: string | null
  attestationRaw: string | null
}

const emptyResult = (): RemoveLocalCopiesResult => ({
  removedSeedLocalIds: [],
  removedSeedUids: [],
  keptSeedLocalIds: [],
})

function normalizeAddresses(addresses: string[]): string[] {
  return [
    ...new Set(
      addresses
        .filter((a): a is string => typeof a === 'string' && a.length > 0)
        .map((a) => a.toLowerCase()),
    ),
  ]
}

/**
 * Find local on-chain seed copies for the given publisher addresses (no delete).
 * Drafts (no uid and no attestationRaw) are excluded. Unless `includeUnpublished`, a copy whose
 * publisher is in `ownedAddresses` and that has a pending outbox op or an unpublished edit (a
 * metadata row with no attestation uid) is kept: listed in `keptSeedLocalIds`, not in the removed ids.
 */
export async function findLocalOnchainCopiesForAddresses(
  addresses: string[],
  options: RemoveLocalCopiesOptions & { ownedAddresses?: readonly string[] } = {},
): Promise<RemoveLocalCopiesResult> {
  const normalized = normalizeAddresses(addresses)
  if (normalized.length === 0) {
    return emptyResult()
  }

  const appDb = BaseDb.getAppDb()
  if (!appDb) {
    return emptyResult()
  }

  const addressSet = new Set(normalized)

  const candidateRows = (await appDb
    .select({
      localId: seeds.localId,
      uid: seeds.uid,
      publisher: seeds.publisher,
      attestationRaw: seeds.attestationRaw,
    })
    .from(seeds)
    .where(or(isNotNull(seeds.uid), isNotNull(seeds.attestationRaw)))) as CandidateSeedRow[]

  const candidates = candidateRows.filter((row) => {
    if (!row.localId) return false
    const publisher = resolvePublisherFromSeedRow(row)
    return publisher != null && addressSet.has(publisher.toLowerCase())
  })

  const owned = options.includeUnpublished
    ? []
    : candidates.filter((row) => publisherIsInOwnedSet(resolvePublisherFromSeedRow(row), options.ownedAddresses ?? []))
  const withWork = await seedsWithUnpublishedWork(owned.map((row) => row.localId!))
  const matched = candidates.filter((row) => !withWork.has(row.localId!))

  return {
    keptSeedLocalIds: [...withWork],
    removedSeedLocalIds: matched.map((r) => r.localId!).filter(Boolean),
    removedSeedUids: matched
      .map((r) => r.uid)
      .filter((u): u is string => typeof u === 'string' && u.length > 0),
  }
}

/** Of `seedLocalIds`, those with a pending outbox op or a metadata row not yet attested. */
async function seedsWithUnpublishedWork(seedLocalIds: string[]): Promise<Set<string>> {
  if (seedLocalIds.length === 0) return new Set()
  const appDb = BaseDb.getAppDb()
  const pending: Array<{ seedLocalId: string }> = await appDb
    .select({ seedLocalId: pendingWrites.seedLocalId })
    .from(pendingWrites)
    .where(and(inArray(pendingWrites.seedLocalId, seedLocalIds), eq(pendingWrites.status, 'pending')))
  const edited: Array<{ seedLocalId: string | null }> = await appDb
    .select({ seedLocalId: metadata.seedLocalId })
    .from(metadata)
    .where(and(inArray(metadata.seedLocalId, seedLocalIds), placeholderUidSql(metadata.uid)))
  return new Set([...pending, ...edited].map((row) => row.seedLocalId).filter((id): id is string => !!id))
}

/**
 * Hard-delete the given seed local ids and related local rows (cascade), their outbox ops included
 * (ADR 0019: an edit of a removed seed has nothing left to apply to; a waiter on one rejects).
 * Does not touch schemas, app_state, or chain.
 */
export async function hardDeleteLocalSeedsByLocalIds(
  seedLocalIds: string[],
  options: {
    /** The database or transaction to write; the app database by default. */
    db?: ReturnType<typeof BaseDb.getAppDb>
    /** An outbox op to keep: the one whose applier is deleting these seeds. */
    keepOpId?: string
  } = {},
): Promise<void> {
  if (seedLocalIds.length === 0) return

  const appDb = options.db ?? BaseDb.getAppDb()
  if (!appDb) return

  await appDb
    .delete(pendingWrites)
    .where(
      options.keepOpId
        ? and(inArray(pendingWrites.seedLocalId, seedLocalIds), ne(pendingWrites.opId, options.keepOpId))
        : inArray(pendingWrites.seedLocalId, seedLocalIds),
    )

  await appDb
    .delete(htmlEmbeddedImageCoPublish)
    .where(
      or(
        inArray(htmlEmbeddedImageCoPublish.parentSeedLocalId, seedLocalIds),
        inArray(htmlEmbeddedImageCoPublish.htmlSeedLocalId, seedLocalIds),
        inArray(htmlEmbeddedImageCoPublish.imageSeedLocalId, seedLocalIds),
      ),
    )

  await appDb
    .delete(arweaveL1FinalizeJobs)
    .where(inArray(arweaveL1FinalizeJobs.seedLocalId, seedLocalIds))

  await appDb
    .delete(publishProcesses)
    .where(inArray(publishProcesses.seedLocalId, seedLocalIds))

  await appDb.delete(metadata).where(inArray(metadata.seedLocalId, seedLocalIds))

  await appDb.delete(versions).where(inArray(versions.seedLocalId, seedLocalIds))

  await appDb.delete(seeds).where(inArray(seeds.localId, seedLocalIds))
}
