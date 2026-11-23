import type { HalfDependency, SeedDependencies } from '../assembleSeeds.js'
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

/** Whether `change` is a pair half `halves` covers: of one of its schemas, by or addressed to one of its addresses. */
function matchesHalves(change: AttestationChange, halves: HalfDependency | undefined): boolean {
  if (!halves || !change.schemaId) return false
  if (!halves.schemaIds.includes(change.schemaId.toLowerCase())) return false
  return (
    (!!change.attester && halves.addresses.includes(change.attester.toLowerCase())) ||
    (!!change.recipient && halves.addresses.includes(change.recipient.toLowerCase()))
  )
}

/** The `halves` filter covering every dependency's, or undefined when none has one. */
function mergeHalves(dependencies: Iterable<SeedDependencies>): HalfDependency | undefined {
  const schemaIds = new Set<string>()
  const addresses = new Set<string>()
  for (const deps of dependencies) {
    for (const uid of deps.halves?.schemaIds ?? []) schemaIds.add(uid.toLowerCase())
    for (const address of deps.halves?.addresses ?? []) addresses.add(address.toLowerCase())
  }
  if (schemaIds.size === 0 || addresses.size === 0) return undefined
  return { schemaIds: [...schemaIds], addresses: [...addresses] }
}

/**
 * Which of the cached seeds changed since `check.checkedAt`: a new or revoked Version of a seed
 * it depends on, a new or revoked property on one of their head Versions, one of those seeds
 * revoked, or a new or revoked pair half its `halves` dependency covers. Returns null when the data source can't list changes (treat everything as changed).
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

  const halves = mergeHalves(dependenciesBySeedUid.values())
  const changes = await dataSource.listChangesSince({
    refUIDs: [...seedUidsByRef.keys()],
    ids: [...seedUidsById.keys()],
    ...(halves && { halves }),
    since: check.checkedAt,
  })

  const seen = new Set(check.seenChangeKeys)
  const changed = new Set<string>()
  for (const change of changes) {
    if (seen.has(changeKey(change))) continue
    for (const seedUid of seedUidsByRef.get(change.refUID) ?? []) changed.add(seedUid)
    for (const seedUid of seedUidsById.get(change.id) ?? []) changed.add(seedUid)
    if (!halves || !matchesHalves(change, halves)) continue
    for (const [seedUid, deps] of dependenciesBySeedUid) {
      if (matchesHalves(change, deps.halves)) changed.add(seedUid)
    }
  }
  return { changed, seenChangeKeys: changes.map(changeKey) }
}

/** A cached item to check: what it depends on, and its own check window. */
export type ItemChangeCheck = ChangeCheck & { dependencies: SeedDependencies }

/**
 * Like findChangedSeeds for items checked at different times: one request from the oldest
 * `checkedAt`, then each item counts only changes after its own `checkedAt` that it hasn't seen.
 * `seenChangeKeys` is per item. Returns null when the data source can't list changes.
 */
export async function findChangedItems(
  dataSource: QueryDataSource,
  checks: Map<string, ItemChangeCheck>,
): Promise<{ changed: Set<string>; seenChangeKeys: Map<string, string[]> } | null> {
  if (!dataSource.listChangesSince) return null
  const changed = new Set<string>()
  const seenChangeKeys = new Map<string, string[]>()
  if (checks.size === 0) return { changed, seenChangeKeys }

  const refUIDs = new Set<string>()
  const ids = new Set<string>()
  let since = Infinity
  for (const check of checks.values()) {
    for (const uid of check.dependencies.refUIDs) refUIDs.add(uid)
    for (const uid of check.dependencies.ids) ids.add(uid)
    since = Math.min(since, check.checkedAt)
  }
  const halves = mergeHalves([...checks.values()].map((check) => check.dependencies))
  const changes = await dataSource.listChangesSince({
    refUIDs: [...refUIDs],
    ids: [...ids],
    ...(halves && { halves }),
    since,
  })

  for (const [seedUid, check] of checks) {
    const refs = new Set(check.dependencies.refUIDs)
    const own = new Set(check.dependencies.ids)
    const seen = new Set(check.seenChangeKeys)
    const keys: string[] = []
    for (const change of changes) {
      if (change.timeCreated <= check.checkedAt && change.revocationTime <= check.checkedAt) continue
      if (!refs.has(change.refUID) && !own.has(change.id) && !matchesHalves(change, check.dependencies.halves)) continue
      keys.push(changeKey(change))
      if (!seen.has(changeKey(change))) changed.add(seedUid)
    }
    seenChangeKeys.set(seedUid, keys)
  }
  return { changed, seenChangeKeys }
}
