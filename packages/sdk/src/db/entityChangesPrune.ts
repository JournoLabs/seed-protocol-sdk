import { lt } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { entityChanges } from '@/seedSchema'

/** entity_changes rows (ADR 0020) older than this are pruned: by the browser's leader tab, and by each Node process. */
export const ENTITY_CHANGES_RETENTION_MS = 10 * 60_000
/** Pruning runs at most this often. */
export const ENTITY_CHANGES_PRUNE_EVERY_MS = 60_000

/**
 * Deletes entity_changes rows older than {@link ENTITY_CHANGES_RETENTION_MS}. Deleting doesn't raise
 * max(seq), so the browser change feed dispatches nothing for it.
 */
export async function pruneEntityChanges(
  db: BaseSQLiteDatabase<'async', unknown, Record<string, unknown>>,
  now = Date.now(),
): Promise<void> {
  await db.delete(entityChanges).where(lt(entityChanges.at, now - ENTITY_CHANGES_RETENTION_MS))
}
