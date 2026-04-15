import { ItemData } from '@/types'
import { and, eq, gt, inArray, isNotNull, isNull, or, SQL, sql } from 'drizzle-orm'
import { toSnakeCase } from 'drizzle-orm/casing'
import { seeds } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { getVersionData } from './subqueries/versionData'
import { batchLatestPublishedVersionBySeedLocalIds } from './batchLatestPublishedVersionBySeedLocalIds'
import { getAddressesForItemsFilter } from '@/helpers/db'
import { ZERO_BYTES32 } from '@/helpers/constants'

type GetItemsDataProps = {
  modelName?: string
  deleted?: boolean
  includeEas?: boolean
  addressFilter?: 'owned' | 'watched' | 'all'
}

type GetItemsData = (props: GetItemsDataProps) => Promise<ItemData[]>

/**
 * List item rows for list UIs. Only includes seeds that have at least one version.
 *
 * - `includeEas: false` (default): drafts only — `seeds.uid` is null, empty, legacy `'NULL'`, or zero-bytes32.
 *   On-chain seeds (real EAS seed UID) require `includeEas: true`.
 * - `latestVersionUid` / `latestVersionLocalId`: head version **row** by `created_at` (may be unattested).
 * - `publishedVersionUid` / `publishedVersionLocalId`: filled in a second batched read (same rules as
 *   `getLatestPublishedVersionRow`).
 */
export const getItemsData: GetItemsData = async ({
  modelName,
  deleted,
  includeEas = false,
  addressFilter,
}): Promise<ItemData[]> => {
  const appDb = BaseDb.getAppDb()

  const conditions: SQL[] = []

  if (!includeEas) {
    conditions.push(
      or(
        isNull(seeds.uid),
        eq(seeds.uid, ''),
        eq(seeds.uid, 'NULL'),
        eq(seeds.uid, ZERO_BYTES32),
      ) as SQL,
    )
  }

  if (modelName) {
    conditions.push(eq(seeds.type, toSnakeCase(modelName)))
  }

  if (addressFilter === 'owned') {
    const ownedAddresses = await getAddressesForItemsFilter('owned')
    if (ownedAddresses.length > 0) {
      conditions.push(
        or(
          inArray(seeds.publisher, ownedAddresses),
          isNull(seeds.publisher)
        ) as SQL
      )
    }
  } else if (addressFilter === 'watched') {
    const watchedAddresses = await getAddressesForItemsFilter('watched')
    if (watchedAddresses.length === 0) {
      return []
    }
    conditions.push(inArray(seeds.publisher, watchedAddresses) as SQL)
  }

  if (deleted) {
    conditions.push(
      or(
        isNotNull(seeds._markedForDeletion),
        eq(seeds._markedForDeletion, 1),
      ) as SQL,
    )
  }

  if (!deleted) {
    conditions.push(
      or(
        isNull(seeds._markedForDeletion),
        eq(seeds._markedForDeletion, 0),
      ) as SQL,
    )
    conditions.push(
      or(isNull(seeds.revokedAt), eq(seeds.revokedAt, 0)) as SQL,
    )
  }

  const versionData = getVersionData()

  // When modelName is not provided (e.g. useItems({})), select each seed's type so Item.create
  // can derive modelName via startCase(props.type). Otherwise loadOrCreateItem throws "modelName is required".
  const selectModelNameOrType = modelName
    ? { modelName: sql<string>`${modelName}` as any }
    : { type: seeds.type }

  let query = appDb
    .with(versionData)
    .select({
      seedLocalId: seeds.localId,
      seedUid: seeds.uid,
      schemaUid: seeds.schemaUid,
      ...selectModelNameOrType,
      attestationCreatedAt: seeds.attestationCreatedAt,
      versionsCount: versionData.versionsCount,
      lastVersionPublishedAt: versionData.lastVersionPublishedAt,
      lastLocalUpdateAt: versionData.lastLocalUpdateAt,
      latestVersionUid: versionData.latestVersionUid,
      latestVersionLocalId: versionData.latestVersionLocalId,
      createdAt: seeds.createdAt,
    })
    .from(seeds)
    .leftJoin(versionData, eq(seeds.localId, versionData.seedLocalId))
    .where(and(gt(versionData.versionsCount, 0), ...conditions))
    .orderBy(sql.raw('COALESCE(attestation_created_at, created_at) DESC'))

  const itemsData = (await query) as ItemData[]
  const seedIds = itemsData
    .map((r) => r.seedLocalId)
    .filter((id): id is string => typeof id === 'string' && id !== '')
  const publishedBySeed = await batchLatestPublishedVersionBySeedLocalIds(seedIds)

  return itemsData.map((row) => {
    const pub = row.seedLocalId ? publishedBySeed.get(row.seedLocalId) : undefined
    return {
      ...row,
      publishedVersionUid: pub?.uid,
      publishedVersionLocalId: pub?.localId ?? undefined,
    }
  })
}
