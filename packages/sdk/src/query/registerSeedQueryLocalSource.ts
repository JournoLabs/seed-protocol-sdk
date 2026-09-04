import {
  clearLocalQuerySource,
  getSeed,
  registerLocalQuerySource,
  type GetSeedOptions,
  type GetSeedResult,
  type QuerySourceMode,
} from '@seedprotocol/query'
import { BaseDb } from '@/db/Db/BaseDb'
import { createLocalQueryDataSource } from './createLocalQueryDataSource'

let registered = false

/**
 * Register the SDK SQLite/files adapter with `@seedprotocol/query`.
 * Safe to call multiple times; re-registers with a fresh adapter instance.
 * No-op when the app DB is not ready yet (unless `force`).
 */
export function registerSeedQueryLocalSource(options?: {
  force?: boolean
}): boolean {
  if (!options?.force && !BaseDb.isAppDbReady()) {
    return false
  }
  try {
    registerLocalQuerySource(createLocalQueryDataSource())
    registered = true
    return true
  } catch (err) {
    console.warn('[sdk/query] registerSeedQueryLocalSource failed:', err)
    return false
  }
}

/** Unregister local query source (tests / client unload). */
export function unregisterSeedQueryLocalSource(): void {
  clearLocalQuerySource()
  registered = false
}

export function isSeedQueryLocalSourceRegistered(): boolean {
  return registered
}

export type GetPublishedSeedRecordOptions = Omit<GetSeedOptions, 'source'> & {
  /** Default `'local'` when adapter is registered; use `'auto'` to fall back to remote. */
  source?: Extract<QuerySourceMode, 'local' | 'auto'>
}

/**
 * Thin published-JSON helper: `getSeed` via the local (or auto) query source.
 * Does not touch Item / drafts / liveQuery.
 *
 * Prefer this (or `@seedprotocol/query` `getSeed` / `queryBySchema`) for
 * canonical published Seed JSON. Use `getItemData` / Item for draft-head authoring.
 */
export async function getPublishedSeedRecord(
  seedUid: string,
  options?: GetPublishedSeedRecordOptions,
): Promise<GetSeedResult | null> {
  if (!registered) {
    registerSeedQueryLocalSource()
  }
  const source = options?.source ?? 'local'
  return getSeed(seedUid, { ...options, source })
}
