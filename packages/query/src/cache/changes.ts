import type { SeedDependencies } from '../assembleSeeds.js'
import type { QueryDataSource } from '../source/types.js'
import type { AttestationChange } from '../types.js'
import type { ChangeCheck } from './types.js'

/**
 * Each change check looks back this far before the previous check started, so an attestation
 * the indexer lists late, or a clock between here and the chain that is off, is still seen.
 * Changes inside the overlap that were already applied are skipped by their key.
 */
export const CHANGE_CHECK_OVERLAP_SECONDS = 600

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** `checkedAt` for a check that started at `startedAt`. */
export function checkedAtFor(startedAt: number): number {
  return startedAt - CHANGE_CHECK_OVERLAP_SECONDS
}

/**
 * True when a check found nothing but its window has grown past twice the overlap, so it is worth
 * storing the new `checkedAt` to keep later requests small. (Storing it is otherwise not needed:
 * an unchanged entry's next check sees only changes it has already seen.)
 */
export function checkWindowAged(check: ChangeCheck, startedAt: number): boolean {
  return checkedAtFor(startedAt) - check.checkedAt > CHANGE_CHECK_OVERLAP_SECONDS
}

const changeKey = (change: AttestationChange): string => `${change.id}:${change.revocationTime}`

/**
 * Which of the cached seeds changed since `check.checkedAt`: a new or revoked Version of a seed
 * it depends on, a new or revoked property on one of their head Versions, or one of those seeds
 * revoked. Returns null when the data source can't list changes (treat everything as changed).
 */
export async function findChangedSeeds(
  dataSource: QueryDataSource,
  dependenciesBySeedUid: Map<string, SeedDependencies>,
  check: ChangeCheck,
): Promise<{ changed: Set<string>; seenChangeKeys: string[] } | null> {
  if (!dataSource.listChangesSince) return null
  if (dependenciesBySeedUid.size === 0) {
    return { changed: new Set(), seenChangeKeys: check.seenChangeKeys }
  }

  const seedUidsByRef = new Map<string, string[]>()
  const seedUidsById = new Map<string, string[]>()
  const index = (map: Map<string, string[]>, uid: string, seedUid: string) => {
    const seedUids = map.get(uid)
    if (seedUids) seedUids.push(seedUid)
    else map.set(uid, [seedUid])
  }
  for (const [seedUid, deps] of dependenciesBySeedUid) {
    for (const uid of deps.refUIDs) index(seedUidsByRef, uid, seedUid)
    for (const uid of deps.ids) index(seedUidsById, uid, seedUid)
  }

  const changes = await dataSource.listChangesSince({
    refUIDs: [...seedUidsByRef.keys()],
    ids: [...seedUidsById.keys()],
    since: check.checkedAt,
  })

  const seen = new Set(check.seenChangeKeys)
  const changed = new Set<string>()
  for (const change of changes) {
    if (seen.has(changeKey(change))) continue
    for (const seedUid of seedUidsByRef.get(change.refUID) ?? []) changed.add(seedUid)
    for (const seedUid of seedUidsById.get(change.id) ?? []) changed.add(seedUid)
  }
  return { changed, seenChangeKeys: changes.map(changeKey) }
}
