import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { isPlaceholderUid } from '@seedprotocol/eas'
import {
  arweaveL1FinalizeJobs,
  metadata,
  pendingWrites,
  publishProcesses,
  seeds,
  versions,
} from '@/seedSchema'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'

/** The app database or a transaction on it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const SEED_FILL_COLUMNS = ['schemaUid', 'type', 'modelFileId', 'publisher', 'attestationRaw', 'attestationCreatedAt'] as const
const VERSION_FILL_COLUMNS = ['seedUid', 'seedType', 'attestationRaw', 'attestationCreatedAt', 'publisher', 'revokedAt'] as const

/** The columns `keep` lacks (null) that `dup` has. */
const missingColumns = <T extends Record<string, unknown>>(keep: T, dup: T, columns: readonly (keyof T)[]) =>
  Object.fromEntries(columns.filter((c) => keep[c] == null && dup[c] != null).map((c) => [c, dup[c]]))

/**
 * Merges the seed row `dupLocalId` into `keepLocalId`, as migration 0029 does for the rows it
 * finds: a property row the survivor already has under the same attestation uid is dropped, every
 * other reference moves, columns the survivor lacks are copied, and the duplicate is deleted. For
 * a row another writer inserted for the same seed uid (`seeds_attested_uid_unique`). Run it in the
 * transaction that writes the uid.
 */
export async function mergeSeedRowInto(db: Db, dupLocalId: string, keepLocalId: string): Promise<void> {
  if (dupLocalId === keepLocalId) return
  const [dup] = await db.select().from(seeds).where(eq(seeds.localId, dupLocalId)).limit(1)
  const [keep] = await db.select().from(seeds).where(eq(seeds.localId, keepLocalId)).limit(1)
  if (!dup || !keep) return

  const keptUids = (
    await db.select({ uid: metadata.uid }).from(metadata).where(eq(metadata.seedLocalId, keepLocalId))
  )
    .map((row: { uid: string | null }) => row.uid)
    .filter((uid: string | null): uid is string => !isPlaceholderUid(uid))
  if (keptUids.length > 0) {
    await db.delete(metadata).where(and(eq(metadata.seedLocalId, dupLocalId), inArray(metadata.uid, keptUids)))
  }

  for (const table of [metadata, versions, pendingWrites, publishProcesses, arweaveL1FinalizeJobs]) {
    await db.update(table).set({ seedLocalId: keepLocalId }).where(eq(table.seedLocalId, dupLocalId))
  }
  await db
    .update(htmlEmbeddedImageCoPublish)
    .set({ imageSeedLocalId: keepLocalId })
    .where(eq(htmlEmbeddedImageCoPublish.imageSeedLocalId, dupLocalId))
  // (parent, html, stable_key) is unique: a row the survivor already has stays, the duplicate's goes.
  for (const column of ['parent_seed_local_id', 'html_seed_local_id']) {
    await db.run(
      sql`UPDATE OR IGNORE ${htmlEmbeddedImageCoPublish} SET ${sql.identifier(column)} = ${keepLocalId} WHERE ${sql.identifier(column)} = ${dupLocalId}`,
    )
    await db.run(sql`DELETE FROM ${htmlEmbeddedImageCoPublish} WHERE ${sql.identifier(column)} = ${dupLocalId}`)
  }

  await db.delete(seeds).where(eq(seeds.localId, dupLocalId))
  const fill = missingColumns(keep, dup, SEED_FILL_COLUMNS)
  if (Object.keys(fill).length > 0) await db.update(seeds).set(fill).where(eq(seeds.localId, keepLocalId))
}

/**
 * Merges the version row `dupLocalId` into `keepLocalId`: its property rows and finalize jobs
 * move, columns the survivor lacks are copied, and it is deleted. For a row another writer
 * inserted for the same version uid (`versions_attested_uid_unique`).
 */
export async function mergeVersionRowInto(db: Db, dupLocalId: string, keepLocalId: string): Promise<void> {
  if (dupLocalId === keepLocalId) return
  const [dup] = await db.select().from(versions).where(eq(versions.localId, dupLocalId)).limit(1)
  const [keep] = await db.select().from(versions).where(eq(versions.localId, keepLocalId)).limit(1)
  if (!dup || !keep) return
  for (const table of [metadata, arweaveL1FinalizeJobs]) {
    await db.update(table).set({ versionLocalId: keepLocalId }).where(eq(table.versionLocalId, dupLocalId))
  }
  await db.delete(versions).where(eq(versions.localId, dupLocalId))
  const fill = missingColumns(keep, dup, VERSION_FILL_COLUMNS)
  if (Object.keys(fill).length > 0) await db.update(versions).set(fill).where(eq(versions.localId, keepLocalId))
}

/** Local ids of the other seed rows holding `uid` (none for a placeholder). */
export async function otherSeedRowsWithUid(db: Db, uid: string, localId: string): Promise<string[]> {
  if (isPlaceholderUid(uid)) return []
  const rows = await db
    .select({ localId: seeds.localId })
    .from(seeds)
    .where(and(eq(seeds.uid, uid), ne(seeds.localId, localId)))
  return rows.map((row: { localId: string | null }) => row.localId).filter(Boolean)
}

/** Local ids of the other version rows holding `uid` (none for a placeholder). */
export async function otherVersionRowsWithUid(db: Db, uid: string, localId: string): Promise<string[]> {
  if (isPlaceholderUid(uid)) return []
  const rows = await db
    .select({ localId: versions.localId })
    .from(versions)
    .where(and(eq(versions.uid, uid), ne(versions.localId, localId)))
  return rows.map((row: { localId: string | null }) => row.localId).filter(Boolean)
}
