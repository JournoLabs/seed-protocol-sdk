import { ItemData } from '@/types'
import { and, eq, gt, isNotNull, isNull, or, SQL, sql } from 'drizzle-orm'
import { toSnakeCase } from 'drizzle-orm/casing'
import { seeds } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { getVersionData } from './subqueries/versionData'
import { batchLatestPublishedVersionBySeedLocalIds } from './batchLatestPublishedVersionBySeedLocalIds'
import { getAddressesForItemsFilter } from '@/helpers/db'
import { publisherInAddressListSql } from '@/helpers/ownership'
import { ZERO_BYTES32 } from '@/helpers/constants'

type GetItemsDataProps = {
  modelName?: string
  /** Restrict to items of one model (seeds.model_file_id), by its Model.id ... */
  modelFileId?: string
  /** ... or by the schema that defines `modelName`. */
  schemaName?: string
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
 * - `latestVersionUid` / `latestVersionLocalId`: head version **row** by `created_at` (may be unattested),
 *   skipping revoked versions; null when every version is revoked.
 * - `publishedVersionUid` / `publishedVersionLocalId`: filled in a second batched read (same rules as
 *   `getLatestPublishedVersionRow`: attested and not revoked).
 */
export const getItemsData: GetItemsData = async ({
  modelName,
  modelFileId,
  schemaName,
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

  if (!modelFileId && schemaName && modelName) {
    const { resolveModelRecord } = await import('./resolveModelRecord')
    modelFileId = (await resolveModelRecord(modelName, { schemaName }))?.schemaFileId ?? undefined
    if (!modelFileId) return [] // that schema has no such model
  }
  if (modelFileId) {
    conditions.push(eq(seeds.modelFileId, modelFileId))
  }

  if (addressFilter === 'owned') {
    const ownedAddresses = await getAddressesForItemsFilter('owned')
    conditions.push(publisherInAddressListSql(seeds.publisher, ownedAddresses))
  } else if (addressFilter === 'watched') {
    const watchedAddresses = await getAddressesForItemsFilter('watched')
    conditions.push(publisherInAddressListSql(seeds.publisher, watchedAddresses))
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
      modelFileId: seeds.modelFileId,
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
