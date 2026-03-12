import { ItemData } from '@/types'
import { and, eq, gt, inArray, isNotNull, isNull, or, SQL, sql } from 'drizzle-orm'
import { toSnakeCase } from 'drizzle-orm/casing'
import { seeds } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { getVersionData } from './subqueries/versionData'
import { getOwnedAddressesFromDb, getWatchedAddressesFromDb } from '@/helpers/db'
import { getGetAdditionalSyncAddresses } from '@/helpers/publishConfig'

type GetItemsDataProps = {
  modelName?: string
  deleted?: boolean
  includeEas?: boolean
  addressFilter?: 'owned' | 'watched' | 'all'
}

type GetItemsData = (props: GetItemsDataProps) => Promise<ItemData[]>

export const getItemsData: GetItemsData = async ({
  modelName,
  deleted,
  includeEas = false,
  addressFilter,
}): Promise<ItemData[]> => {
  const appDb = BaseDb.getAppDb()

  const conditions: SQL[] = []

  if (!includeEas) {
    conditions.push(or(isNull(seeds.uid), eq(seeds.uid, '')) as SQL)
  }

  if (modelName) {
    conditions.push(eq(seeds.type, toSnakeCase(modelName)))
  }

  if (addressFilter === 'owned') {
    let ownedAddresses = await getOwnedAddressesFromDb()
    const additionalGetter = getGetAdditionalSyncAddresses()
    if (additionalGetter) {
      const additional = await additionalGetter()
      if (additional?.length) {
        const seen = new Set(ownedAddresses.map((a) => a.toLowerCase()))
        for (const addr of additional) {
          if (addr && !seen.has(addr.toLowerCase())) {
            seen.add(addr.toLowerCase())
            ownedAddresses = [...ownedAddresses, addr]
          }
        }
      }
    }
    if (ownedAddresses.length > 0) {
      conditions.push(
        or(
          inArray(seeds.publisher, ownedAddresses),
          isNull(seeds.publisher)
        ) as SQL
      )
    }
  } else if (addressFilter === 'watched') {
    const watchedAddresses = await getWatchedAddressesFromDb()
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
    .groupBy(seeds.localId)

  const itemsData = (await query) as ItemData[]

  return itemsData
}
