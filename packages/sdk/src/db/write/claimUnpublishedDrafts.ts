import { and, eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { selectInBatches, writeInBatches } from '@/db/sqlParamBatches'
import { metadata, seeds, versions } from '@/seedSchema'
import { pendingWrites } from '@/seedSchema/PendingWriteSchema'
import type { CreateItemOp } from '@/outbox/itemAppliers'
import { normalizePublisher } from '@/helpers/addresses'
import { isLocalUnsealedDraft, type SeedOwnershipRow } from '@/helpers/ownership'

type ClaimableRow = SeedOwnershipRow & { localId: string | null }

export type ClaimUnpublishedDraftsResult = {
  seeds: number
  versions: number
  metadata: number
  /** Item.create ops still pending, whose seed will be created with the publisher. */
  pendingCreates: number
  /** Local ids of the claimed seeds, so loaded Items can take the new publisher. */
  seedLocalIds: string[]
}

const emptyResult = (): ClaimUnpublishedDraftsResult => ({
  seeds: 0,
  versions: 0,
  metadata: 0,
  pendingCreates: 0,
  seedLocalIds: [],
})

/**
 * Gives `publisher` to local drafts that belong to no wallet yet: seeds with no publisher, no real
 * uid and no attestationRaw, and those seeds' versions and property rows that are unsealed too.
 * Versions and property rows go only with their seed, so rows of a seed that already has a
 * publisher are never claimed. Sealed rows (real EAS uid or attestationRaw) are never touched.
 *
 * Pending Item.create ops with no publisher get it too, in the same transaction: the drainer applies
 * an op's value as its claim reads it (ADR 0019), so a create applied before or after this one ends
 * up claimed either way.
 */
export async function claimUnpublishedDrafts(
  publisher: string,
): Promise<ClaimUnpublishedDraftsResult> {
  const normalized = normalizePublisher(publisher)
  if (!normalized) return emptyResult()

  if (!BaseDb.getAppDb()) return emptyResult()

  const isClaimable = (row: ClaimableRow): row is ClaimableRow & { localId: string } =>
    typeof row.localId === 'string' && row.localId !== '' && isLocalUnsealedDraft(row)

  return BaseDb.transaction(async (tx: ReturnType<typeof BaseDb.getAppDb>) => {
    const stamp = async (table: typeof seeds | typeof versions | typeof metadata, ids: string[]) => {
      await writeInBatches(ids, (chunk) =>
        tx.update(table).set({ publisher: normalized }).where(inArray(table.localId, chunk)),
      )
    }

    const pendingCreateIds = await claimPendingCreates(tx, normalized)

    const seedRows = (await tx
      .select({
        localId: seeds.localId,
        uid: seeds.uid,
        publisher: seeds.publisher,
        attestationRaw: seeds.attestationRaw,
      })
      .from(seeds)) as ClaimableRow[]
    const seedIds = seedRows.filter(isClaimable).map((row) => row.localId)
    if (seedIds.length === 0) {
      return { ...emptyResult(), pendingCreates: pendingCreateIds.length, seedLocalIds: pendingCreateIds }
    }

    const claimChildren = async (table: typeof versions | typeof metadata): Promise<string[]> => {
      const rows = (await selectInBatches(seedIds, (chunk) =>
        tx
          .select({
            localId: table.localId,
            uid: table.uid,
            publisher: table.publisher,
            attestationRaw: table.attestationRaw,
          })
          .from(table)
          .where(inArray(table.seedLocalId, chunk)),
      )) as ClaimableRow[]
      const ids = rows.filter(isClaimable).map((row) => row.localId)
      await stamp(table, ids)
      return ids
    }

    await stamp(seeds, seedIds)
    const versionIds = await claimChildren(versions)
    const metadataIds = await claimChildren(metadata)

    return {
      seeds: seedIds.length,
      versions: versionIds.length,
      metadata: metadataIds.length,
      pendingCreates: pendingCreateIds.length,
      seedLocalIds: [...seedIds, ...pendingCreateIds],
    }
  })
}

/** Sets `publisher` on pending create ops that have none; returns their seeds' local ids. */
async function claimPendingCreates(tx: ReturnType<typeof BaseDb.getAppDb>, publisher: string): Promise<string[]> {
  const ops = await tx
    .select({ opId: pendingWrites.opId, seedLocalId: pendingWrites.seedLocalId, value: pendingWrites.value })
    .from(pendingWrites)
    .where(and(eq(pendingWrites.kind, 'create'), eq(pendingWrites.status, 'pending')))
  const claimed: string[] = []
  for (const op of ops) {
    const value = op.value ? (JSON.parse(op.value) as CreateItemOp) : undefined
    if (!value || value.seed.fields.publisher) continue
    value.seed.fields = { ...value.seed.fields, publisher }
    await tx.update(pendingWrites).set({ value: JSON.stringify(value) }).where(eq(pendingWrites.opId, op.opId))
    claimed.push(op.seedLocalId)
  }
  return claimed
}
